import * as fs from 'fs'
import * as path from 'path'

import { S3 } from 'aws-sdk'
import * as mime from 'mime-types'
import * as pThrottle from 'p-throttle'
import type { EntryInfo } from 'readdirp'
import readdirp from 'readdirp'

import { ETagHash } from './ETags'

const s3 = new S3()

const throttle = pThrottle({
  limit: 500,
  interval: 2000,
})

interface tempPutObjectRequest {
  Bucket?: string
  Key?: string
  ContentType?: string
}

interface syncObjects {
  key?: string
  bucket?: string
  file?: EntryInfoS3
}

async function syncObject(from: syncObjects, to: syncObjects): Promise<S3.ManagedUpload.SendData> {
  const params: tempPutObjectRequest = {}
  if (to.key && mime.lookup(to.key)) {
    params.ContentType = mime.lookup(to.key) || undefined
  }

  let body

  if (from.file?.local) {
    body = fs.createReadStream(from.file.fullPath)
  } else if (from.bucket && from.key) {
    body = s3.getObject({ Bucket: from.bucket, Key: from.key }).createReadStream()
  }

  return s3
    .upload(
      Object.assign(params, {
        Bucket: to.bucket,
        Key: to.key,
        ACL: 'public-read',
        Body: body,
      } as AWS.S3.PutObjectRequest)
    )
    .promise()
}

const throttledSync = throttle(syncObject)

async function deleteObjects(
  Bucket: string,
  prefix: string,
  files: AWS.S3.Object[]
): Promise<S3.DeleteObjectsOutput | boolean> {
  if (files.length) {
    // Batch delete supports up to 1000 files
    if (files.length > 1000) {
      await deleteObjects(Bucket, prefix, files.slice(1000))
    }

    const params = {
      Bucket,
      Delete: {
        Objects: files.slice(0, 1000).map((file) => ({ Key: prefix + file.Key })),
        Quiet: false,
      },
    } as AWS.S3.DeleteObjectsRequest

    return s3.deleteObjects(params).promise()
  }
  return false
}

async function fetchList(
  bucket: string,
  prefix: string,
  ContinuationToken: string | undefined
): Promise<S3.ListObjectsV2Output> {
  const params = {
    Bucket: bucket,
    MaxKeys: 1000,
    Prefix: prefix,
    ContinuationToken,
  }
  return s3.listObjectsV2(params).promise()
}

async function listAll(bucket: string, prefix: string): Promise<EntryInfoS3[]> {
  let allFiles = [] as AWS.S3.ObjectList
  let fetchedList = {} as AWS.S3.ListObjectsV2Output
  do {
    fetchedList = await fetchList(bucket, prefix, fetchedList.NextContinuationToken)
    if (fetchedList.Contents) {
      allFiles = allFiles.concat(fetchedList.Contents)
    }
  } while (fetchedList.NextContinuationToken)

  return allFiles.map((c) => {
    if (c.Key) {
      c.Key = c.Key.replace(prefix, '')
    }
    return c
  }) as EntryInfoS3[]
}

interface syncParams {
  localFolder?: string
  destinationBucket: string
  destinationPrefix: string
  originBucket?: string
  originPrefix?: string
}

interface cleanParams {
  destinationBucket?: string
  destinationPrefix?: string
}

interface EntryInfoS3 extends EntryInfo {
  ETag?: string
  local?: boolean
  Size?: number
  Key?: string
}

interface SyncResult {
  count: number
  bytes: number
}

export async function cleanup({
  destinationBucket,
  destinationPrefix,
}: cleanParams): Promise<S3.DeleteObjectsOutput | boolean> {
  if (destinationBucket && destinationPrefix) {
    const deleteFiles = await listAll(destinationBucket, destinationPrefix)
    return deleteObjects(destinationBucket, destinationPrefix, deleteFiles)
  }
  return false
}

export async function sync({
  localFolder,
  destinationBucket,
  destinationPrefix,
  originBucket,
  originPrefix,
}: syncParams): Promise<SyncResult> {
  const startSyncTime = new Date()

  const toList = await listAll(destinationBucket, destinationPrefix)
  const toETags = toList.map((file) => `${file.Key}${file.ETag}`)

  let fromList = [] as EntryInfoS3[]
  // let fromETags = [] as (string | undefined)[]
  let fromKeys = [] as (string | undefined)[]

  if (localFolder) {
    const fromFolder = await readdirp.promise(localFolder)
    fromList = fromFolder.map((file) => {
      const fi: EntryInfoS3 = file
      const content = fs.readFileSync(file.fullPath)
      fi.ETag = `"${new ETagHash().update(content).digest()}"`
      fi.local = true
      fi.Size = content.length
      fi.Key = file.path
      return fi
    })
  } else {
    if (originBucket && originPrefix) {
      fromList = await listAll(originBucket, originPrefix)
    }
  }
  fromKeys = fromList.map((file) => `${file.Key}`)
  // fromETags = fromList.map((file) => `${file.Key}${file.ETag}`)

  const addedFiles = fromList.filter((file) => !toETags.includes(`${file.Key}${file.ETag}`))
  const deletedFiles = toList.filter((file) => !fromKeys.includes(file.Key))

  addedFiles.forEach((file) => console.log('+ ', file.path, `(${file.Size} bytes)`))
  deletedFiles.forEach((file) => console.log('- ', file.Key, `(${file.Size} bytes)`))
  console.log('--\nnewFiles:', addedFiles.length)
  console.log('deletedFiles:', deletedFiles.length)

  let count = 0
  let bytes = 0
  const startTransferTime = new Date()
  const allSyncPromises = addedFiles.map((file) => {
    count++
    if (file.Size && file.Key) {
      bytes += file.Size
      if (file.local) {
        return throttledSync(
          { file },
          { bucket: destinationBucket, key: path.join(destinationPrefix, file.Key) }
        )
      }
      if (originPrefix) {
        return throttledSync(
          { bucket: originBucket, key: originPrefix + file.Key },
          { bucket: destinationBucket, key: destinationPrefix + file.Key }
        )
      }
    }
    return 0
  }) as Promise<S3.DeleteObjectsOutput | S3.ManagedUpload.SendData | boolean>[]
  allSyncPromises.push(deleteObjects(destinationBucket, destinationPrefix, deletedFiles))

  await Promise.all(allSyncPromises)
  const seconds = Math.floor(new Date().getTime() - startTransferTime.getTime()) / 1000
  const syncSeconds = Math.floor(new Date().getTime() - startSyncTime.getTime()) / 1000
  if (seconds > 0) {
    const speed = Math.floor(bytes / seconds / 1024 / 1024 * 8 * 100) / 100
    console.log(
      `--\n⏰ ${bytes} bytes in ${seconds} seconds (${speed} Mb/s)\nTotal sync time: ${syncSeconds} seconds`
    )
  }
  return { count, bytes }
}
