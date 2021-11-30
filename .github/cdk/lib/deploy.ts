import 'source-map-support/register'

import * as cdk from '@aws-cdk/core'
import { SdkProvider } from 'aws-cdk/lib/api/aws-auth'
import { CloudFormationDeployments } from 'aws-cdk/lib/api/cloudformation-deployments'
import { CloudFormation, CloudFront } from 'aws-sdk'

import { sync } from '../util/s3Sync'

import { FrontendStack } from './frontend-stack'
import type { FrontendParams } from './frontend-stack'

export type DeployParams = FrontendParams & {
  buildPath?: string
  environment?: string
  product?: string
  repository?: string
}

// TODO: rework to make it configurable via env vars and/or params.
const awsConfig = { region: 'us-east-1' }
const cloudformation = new CloudFormation(awsConfig)
const cloudfront = new CloudFront(awsConfig)

export default async function deploy(params: DeployParams): Promise<number> {
  const app = new cdk.App()

  const stack = new FrontendStack(app, params.stackName, {
    env: {
      // TODO: rework to make it configurable via env vars and/or params.
      region: 'us-east-1',
    },
    ...params,
  })

  const stackArtifact = app.synth().getStackByName(params.stackName)
  const sdkProvider = await SdkProvider.withAwsCliCompatibleDefaults()
  const cloudFormation = new CloudFormationDeployments({ sdkProvider })

  const deployPromise = cloudFormation.deployStack({
    stack: stackArtifact,
    tags: [
      { Key: 'Name', Value: params.stackName },
      { Key: 'Environment', Value: params.environment ?? '' },
      { Key: 'Product', Value: params.product ?? '' },
      { Key: 'Repository', Value: params.repository ?? '' },
    ],
  })

  const syncPromise = sync({
    localFolder: params.buildPath,
    destinationBucket: params.bucketName,
    destinationPrefix: params.originPath,
  })

  const promisesResults = await Promise.all([deployPromise, syncPromise])

  const resources = await cloudformation
    .describeStackResources({
      LogicalResourceId: promisesResults[0].stackArtifact.template.Outputs.DistributionId.Value
        .Ref as string,
      StackName: stack.stackName,
    })
    .promise()

  if (resources.StackResources?.[0].PhysicalResourceId) {
    console.log(`Invalidate "${resources.StackResources[0].PhysicalResourceId}"`)
    const invalidationResult = await cloudfront
      .createInvalidation({
        DistributionId: resources.StackResources[0].PhysicalResourceId,
        InvalidationBatch: {
          CallerReference: new Date().getTime().toString(),
          Paths: {
            Quantity: 1,
            Items: ['/*'],
          },
        },
      })
      .promise()

    console.log(JSON.stringify(invalidationResult.Invalidation, null, 2))
  }

  return 0
}
