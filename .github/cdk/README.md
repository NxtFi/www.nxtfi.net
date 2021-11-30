# CDK deploy CLI

A tool to deploy static websites to the CDN.

## Context

We have several web front-ends and most of them are "static" in the sense that they don't require a service to render content on each http request. These web properties usually connect to one of our APIs or are very simple landing pages.

We needed a tool to quickly and reliably deploy new and existing web properties of this kind to the CDN (CloudFront) with some level of customization. This project aims to provide a CLI for that.

## Infrastructure

We use [AWS CloudFront](https://aws.amazon.com/cloudfront/) CDN to serve websites across regions, the files themselves are stored in [AWS S3](https://aws.amazon.com/s3/), the domains and SSL certificates are managed by [AWS Route53](https://aws.amazon.com/route53/), and an optional extra layer of logic is added to the CDN using [AWS Lambda@Edge](https://aws.amazon.com/lambda/edge/).

All these AWS resources are managed using a mix of [AWS CDK](https://aws.amazon.com/cdk/) (which in turn uses [AWS CloudFormation](https://aws.amazon.com/cloudformation/)) and custom in-house tools inside this project.

## Requirements

### AWS credentials

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` variables should exist in the deployment environment and should correspond to a IAM user with sufficient permissions to execute both `cli deploy` and `cli destroy` commands. 

### AWS IAM permissions

AWS managed policies required: 

 - AWSCloudFormationFullAccess
 - AmazonS3FullAccess
 - AWSLambdaFullAccess
 - CloudFrontFullAccess
 - AmazonRoute53FullAccess
 - AmazonRoute53DomainsFullAccess

Additional permissions required:

 - iam:createRole
 - iam:DetachRolePolicy
 - iam:DeleteRole
 - iam:AttachRolePolicy
 - iam:PutRolePolicy

### DNS entries and Route53 SSL Certificates

The `cli deploy` command takes care of creating the publicly accesible subdomain+domain in Route53 and connect it to the corresponding CloudFormation Distribution. 

The `certificateArn` domain and/or wildcard must match that of the subdomain you're specifying.

### S3 bucket

## Usage

The `cli deploy` command is used to sync a given build folder to S3 and setup or update a CloudFront distribution for the given subdomain+domain combination. All the params in the following example are required.

```shell
npx ts-node ./cdk/bin/cli deploy \
  --stackName testing-cdk-www \
  --zoneId Z24OHT7RKXL6TO \
  --zoneDomain masterworks.io \
  --subDomain testing-cdk.www \
  --bucketName shared-frontend-bucket \
  --certificateArn arn:aws:acm:us-east-1:906503920888:certificate/c8a9b0a3-dde2-40d7-8fe5-61e15a326cec \
  --originPath testing-cdk-www/ \
  --buildPath _build/public-folder/
```

The parameters above are the ones we use to deploy www.masterworks.io and you have to adjust them according to the site you're trying to deploy.

### With lambda@edge functions

The behavior of the CDN for a given deploy can be customized using lambda@edge functions. To opt-in, you have to provide a folder as the `--lambdaEdgesPath` param containing some TypeScript or JavaScript files with named as the [CloudFront events](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-cloudfront-trigger-events.html) you're trying to intercept:

- origin-request
- origin-response
- viewer-request
- viewer-response

Optionally, you can also inject environment variables to the lambda@edge functions with the `--envPrefix` param. Any env var present on your environment at deploy that starts with the prefix will be added to all of the deployed functions.

The reasoning behind the prefix is that the environment from which the site is deployed may contain sensitive information you don't want to include.

Full example:

```shell
npx ts-node ./cdk/bin/cli deploy \
  --stackName testing-cdk.www \
  --zoneId Z24OHT7RKXL6TO \
  --zoneDomain masterworks.io \
  --subDomain dev.website \
  --bucketName shared-frontend-bucket \
  --certificateArn arn:aws:acm:us-east-1:906503920888:certificate/c8a9b0a3-dde2-40d7-8fe5-61e15a326cec \
  --originPath testing-cdk.www/ \
  --buildPath _build/public-folder/
  --lambdaEdgesPath .cdn/lambdaEdge/ \
  --envPrefix REACT_APP_
```

### Destroy

The `cli destroy` command is used to clean and release all resources used by a CloudFront distribution and the connected subdomain+domain. All the params in the following example are required.

```shell
npx ts-node ./cdk/bin/cli destroy \
  --stackName testing-cdk.www \
  --originPath testing-cdk.www/ \
  --bucketName shared-frontend-bucket
```

### Best Practices

Deployments should be only executed from [Github Actions](https://github.com/features/actions), therefore AWS credentials should only stored in the Github's repository secrets instead of locally in the developer's machine.
