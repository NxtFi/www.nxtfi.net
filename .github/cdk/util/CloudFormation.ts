import { CloudFormation } from 'aws-sdk'
// import type { AWSError } from 'aws-sdk'
import type { Stacks, Stack } from 'aws-sdk/clients/cloudformation'

import { awsRetry } from './awsRetry'

const awsConfig = { region: 'us-east-1' }
const cloudformation = new CloudFormation(awsConfig)

async function describeStacksPromise(
  stackData: CloudFormation.DescribeStacksInput
): Promise<CloudFormation.DescribeStacksOutput | undefined> {
  return cloudformation.describeStacks({ StackName: stackData.StackName }).promise()
}

export function getOutputs(stack: Stack): Record<string, string> | undefined {
  if (!stack.Outputs) {
    return undefined
  }

  const results: Record<string, string> = {}

  for (const { OutputKey, OutputValue } of stack.Outputs) {
    if (typeof OutputKey === 'string' && typeof OutputValue === 'string') {
      results[OutputKey] = OutputValue
    }
  }

  return results
}

const retryStacksDescription = awsRetry(describeStacksPromise)

export async function listStacks(repositoryFilter: string): Promise<Stacks> {
  const productStacks = [] as Stacks

  const stacks = (await cloudformation
    .listStacks({
      StackStatusFilter: [
        'CREATE_FAILED',
        'CREATE_COMPLETE',
        'ROLLBACK_FAILED',
        'ROLLBACK_COMPLETE',
        'DELETE_FAILED',
        'UPDATE_COMPLETE',
        'UPDATE_FAILED',
        'UPDATE_ROLLBACK_FAILED',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
        'IMPORT_ROLLBACK_FAILED',
        'IMPORT_ROLLBACK_COMPLETE',
      ],
    })
    .promise()) as CloudFormation.ListStacksOutput

  if (stacks.StackSummaries) {
    const stackDescriptions = await Promise.all(stacks.StackSummaries.map(retryStacksDescription))

    stackDescriptions.forEach((stackDescription) => {
      const stackData = stackDescription?.Stacks as Stacks
      const [stack] = stackData

      stack.Tags?.forEach((tag) => {
        if (tag.Key === 'Repository' && tag.Value === repositoryFilter) {
          productStacks.push(stack)
        }
      })
    })

    return productStacks
  }
  return []
}
