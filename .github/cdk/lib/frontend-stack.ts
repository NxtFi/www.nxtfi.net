import * as fs from 'fs'
import * as path from 'path'

import { Certificate } from '@aws-cdk/aws-certificatemanager'
import type { BehaviorOptions, EdgeLambda } from '@aws-cdk/aws-cloudfront'
import {
  LambdaEdgeEventType,
  Distribution,
  CachePolicy,
  CacheCookieBehavior,
  CacheQueryStringBehavior,
  ViewerProtocolPolicy,
  PriceClass,
  SecurityPolicyProtocol,
  OriginRequestPolicy,
  AllowedMethods,
  OriginProtocolPolicy,
} from '@aws-cdk/aws-cloudfront'
import { S3Origin, HttpOrigin } from '@aws-cdk/aws-cloudfront-origins'
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs'
import { HostedZone, ARecord, RecordTarget } from '@aws-cdk/aws-route53'
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets'
import { Bucket } from '@aws-cdk/aws-s3'
import type { StackProps, Construct } from '@aws-cdk/core'
import { Duration, Stack, CfnOutput } from '@aws-cdk/core'
type LambdaEdgeEventTypesType = Record<string, LambdaEdgeEventType>

export interface FrontendParams {
  stackName: string
  originPath: string
  bucketName: string
  certificateArn: string
  subDomain: string
  zoneDomain: string
  zoneId: string

  additionalMapping?: string

  lambdaEdgesPath?: string
  envPrefix?: string
}

type ObjectLiteral = Record<string, BehaviorOptions>

export type FrontendProps = FrontendParams & StackProps

const lambdaEdgeEventTypes = {
  'viewer-request.js': LambdaEdgeEventType.VIEWER_REQUEST,
  'viewer-response.js': LambdaEdgeEventType.VIEWER_RESPONSE,
  'origin-request.js': LambdaEdgeEventType.ORIGIN_REQUEST,
  'origin-response.js': LambdaEdgeEventType.ORIGIN_RESPONSE,
} as LambdaEdgeEventTypesType

export class FrontendStack extends Stack {
  constructor(scope: Construct, name: string, props: FrontendProps) {
    super(scope, name, props)

    // Stack parameters
    const siteDomain = `${props.subDomain}.${props.zoneDomain}`
    const environment: Record<string, string> = {}

    if (props.envPrefix) {
      for (const [key, val] of Object.entries(process.env)) {
        if (key.startsWith(props.envPrefix) && val) {
          environment[`process.env.${key}`] = JSON.stringify(val)
        }
      }
    }

    // Stack components
    const zone = HostedZone.fromHostedZoneAttributes(this, 'MWHostedZone', {
      hostedZoneId: props.zoneId,
      zoneName: props.zoneDomain,
    })

    const siteBucket = Bucket.fromBucketAttributes(this, 'siteBucket', {
      bucketName: props.bucketName,
    })

    let edgeLambdas: EdgeLambda[] = []

    if (props.lambdaEdgesPath) {
      const lambdasPath = props.lambdaEdgesPath

      edgeLambdas = fs
        .readdirSync(path.resolve(process.cwd(), lambdasPath))
        .filter((eachFile) => eachFile in lambdaEdgeEventTypes)
        .map((sourceFile) => {
          const lambdaEdgeFunction = new NodejsFunction(this, sourceFile.split('.js')[0], {
            entry: path.resolve(process.cwd(), lambdasPath, sourceFile),
            bundling: {
              define: environment,
            },
          })

          return {
            functionVersion: lambdaEdgeFunction.currentVersion,
            eventType: lambdaEdgeEventTypes[sourceFile],
          } as EdgeLambda
        })
    }

    const certificate = Certificate.fromCertificateArn(this, 'Cert', props.certificateArn)

    const additionalMappingObject = {} as ObjectLiteral

    if (props.additionalMapping?.includes(':')) {
      additionalMappingObject[props.additionalMapping.split(':')[0]] = {
        origin: new HttpOrigin(props.additionalMapping.split(':')[1], {
          customHeaders: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': siteDomain },
          originPath: '',
          protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
      }
    }

    // CloudFrontWebDistribution
    const distribution = new Distribution(this, 'frontendDistribution', {
      defaultBehavior: {
        origin: new S3Origin(siteBucket, {
          originPath: props.originPath,
        }),
        edgeLambdas,
        cachePolicy:
          props.subDomain === 'www'
            ? new CachePolicy(this, 'cachePolicy', {
                // TODO: abstract this cookies option
                cookieBehavior: CacheCookieBehavior.allowList('x-preview'),
                queryStringBehavior: CacheQueryStringBehavior.all(),
                minTtl: Duration.seconds(0),
                defaultTtl: Duration.seconds(86400),
                maxTtl: Duration.seconds(31536000),
                enableAcceptEncodingGzip: true,
                enableAcceptEncodingBrotli: true,
              })
            : CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: additionalMappingObject,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/',
          ttl: Duration.seconds(300),
        },
      ],
      defaultRootObject: 'index.html',
      comment: `CDK ${props.subDomain}`,
      domainNames: [siteDomain],
      priceClass: PriceClass.PRICE_CLASS_100,
      certificate,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    })

    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })

    new ARecord(this, 'SiteAliasRecord', {
      recordName: siteDomain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      zone,
    })

    new CfnOutput(this, 'FrontendDomain', { value: `https://${siteDomain}/` })

    new CfnOutput(this, 'FrontendS3Bucket', { value: siteBucket.bucketName })
  }
}
