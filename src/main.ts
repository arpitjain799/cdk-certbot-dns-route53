import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as target from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { BashExecFunction } from './lambda-bash';

export interface CertbotOptions {
  /**
   * the domain must host on route53 like example.com.
   *
   * @example - `*.example.com` or `a.example.com` .
   */
  readonly domainName: string;

  /**
   * Email address for important account notifications.
   */
  readonly email: string;

  /**
   * Custom prefix directory on s3 bucket object path.
   * @default - `s3://YOUR_BUCKET_NAME/2021-01-01/your.domain.name/`
   *
   * @example - customPrefixDirectory: '/' -> `s3://YOUR_BUCKET_NAME/your.domain.name/`
   *
   * @example - customPrefixDirectory: 'abc' -> `s3://YOUR_BUCKET_NAME/abc/your.domain.name/`
   */
  readonly customPrefixDirectory?: string;
}

export interface CertbotDnsRoute53JobProps {
  /**
   * run the Job with defined schedule
   * @default - no shedule
   */
  readonly schedule?: events.Schedule;

  /**
   * The S3 bucket to store certificate.
   */
  readonly destinationBucket: s3.IBucket;

  /**
   * The HostZone on route53 to dns-01 challenge.
   */
  readonly zone: r53.IHostedZone;

  /**
   * certbot cmd options.
   */
  readonly certbotOptions: CertbotOptions;
}

export class CertbotDnsRoute53Job extends Construct {
  constructor(scope: Construct, id: string, props: CertbotDnsRoute53JobProps ) {
    super(scope, id);
    const certOptions = {
      BUCKET_NAME: props.destinationBucket.bucketName,
      EMAIL: props.certbotOptions.email,
      DOMAIN_NAME: props.certbotOptions.domainName,
      CUSTOM_PREFIX_DIRECTORY: props.certbotOptions.customPrefixDirectory!,
    };

    const lambdaFun = new BashExecFunction(this, 'certbotDnsRoute53JobLambda', {
      script: path.join(__dirname, '../docker.d/entrypoint.sh'),
      timeout: cdk.Duration.minutes(5),
      environment: {
        ...certOptions,
      },
    });

    props.destinationBucket.grantReadWrite(lambdaFun.handler.role!);
    const route53PolicyJsonList = [{
      Effect: 'Allow',
      Action: [
        'route53:ListHostedZones',
        'route53:GetChange',
      ],
      Resource: [
        '*',
      ],
    },
    {
      Effect: 'Allow',
      Action: [
        'route53:ChangeResourceRecordSets',
      ],
      Resource: [
        `arn:aws:route53:::hostedzone/${props.zone.hostedZoneId}`,
      ],
    }];
    route53PolicyJsonList.forEach(
      e => {
        lambdaFun.handler.role!.addToPrincipalPolicy(iam.PolicyStatement.fromJson(e));
      },
    );


    if (props.schedule) {
      new events.Rule(this, 'ScheduleRule', {
        schedule: props.schedule,
        targets: [
          new target.LambdaFunction(lambdaFun.handler),
        ],
      });
    }
  }
}