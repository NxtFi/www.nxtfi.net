import type { Stack } from 'aws-sdk/clients/cloudformation'

import { getOutputs, listStacks } from '../util/CloudFormation'

import destroy from './destroy'

export type CleanupParams = {
  repository: string
  productBranches: string[]
}

export default async function cleanup({
  repository,
  productBranches,
}: CleanupParams): Promise<void> {
  const productStacks = await listStacks(repository)

  const stacksByName = productStacks.reduce(
    (arr, v) => ({ ...arr, [v.StackName]: v }),
    {}
  ) as Record<string, Stack>

  const productStacksNames = Object.keys(stacksByName)

  console.log(repository, 'existing branches', productBranches)
  console.log(repository, 'stacks', productStacksNames)

  const unusedProductStacks = productStacksNames.filter((productStackName) => {
    const slugNameForStack = productStackName.split('-').slice(0, -1).join('-')
    return !productBranches.includes(slugNameForStack)
  })

  await Promise.all(
    unusedProductStacks.map(async (stackName) => {
      console.log('DESTROY', stackName)
      const stackToDestroy = stacksByName[stackName]
      const outputs = getOutputs(stackToDestroy)

      return destroy({
        stackName,
        originPath: stackName,
        bucketName: outputs?.FrontendS3Bucket,
      })
    })
  )
}
