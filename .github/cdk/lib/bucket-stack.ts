import { Bucket } from '@aws-cdk/aws-s3'
import type { App, StackProps } from '@aws-cdk/core'
import { Stack, RemovalPolicy } from '@aws-cdk/core'

export class BucketStack extends Stack {
  public readonly bucket: Bucket

  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props)

    this.bucket = new Bucket(this, 'CloudFormationBucket', {
      bucketName: 'shared-frontend-bucket',
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,

      /**
       * The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
       * the new bucket, and it will remain in your account until manually deleted. By setting the policy to
       * DESTROY, cdk destroy will attempt to delete the bucket, but will error if the bucket is not empty.
       */
      removalPolicy: RemovalPolicy.RETAIN,

      /**
       * For sample purposes only, if you create an S3 bucket then populate it, stack destruction fails.  This
       * setting will enable full cleanup of the demo.
       */
      autoDeleteObjects: false,
    })
  }
}
