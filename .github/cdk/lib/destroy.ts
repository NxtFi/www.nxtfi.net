import { CloudFormation } from 'aws-sdk'

import { cleanup } from '../util/s3Sync'

// TODO: rework to make it configurable via env vars and/or params.
const awsConfig = { region: 'us-east-1' }
const cloudformation = new CloudFormation(awsConfig)

export type DestroyParams = {
  bucketName?: string
  originPath?: string
  stackName: string
}

export default async function destroy({
  stackName,
  bucketName,
  originPath,
}: DestroyParams): Promise<void> {
  await cloudformation
    .deleteStack({
      StackName: stackName,
    })
    .promise()

  if (bucketName && originPath) {
    await cleanup({
      destinationBucket: bucketName,
      destinationPrefix: originPath,
    })
  }
}
