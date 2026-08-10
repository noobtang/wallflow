import { loadConfig } from '../config';

/**
 * COS 运维(#9): 一键配置 bucket CORS + 检查访问权限(应私有读写)。
 * 用法: npm run cos:configure
 * - putBucketCors: 允许所有来源 GET/HEAD/OPTIONS(小程序/Web 图片加载 + 预检)
 * - getBucketAcl: 打印当前 ACL,人工确认非 public-read
 * 需要 .env 已配置 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION。
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const COS = require('cos-nodejs-sdk-v5') as {
  new (opts: { SecretId: string; SecretKey: string }): {
    putBucketCors: (
      params: Record<string, unknown>,
      cb: (err: { message?: string; Code?: string } | null, data: unknown) => void,
    ) => void;
    getBucketAcl: (
      params: Record<string, unknown>,
      cb: (err: { message?: string; Code?: string } | null, data: { AccessControlList?: string }) => void,
    ) => void;
  };
};

function main(): void {
  const config = loadConfig();
  if (!config.COS_SECRET_ID || !config.COS_SECRET_KEY || !config.COS_BUCKET) {
    console.error('缺少 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET,请在 backend/.env 补全');
    process.exit(1);
  }
  const cos = new COS({ SecretId: config.COS_SECRET_ID, SecretKey: config.COS_SECRET_KEY });
  const bucket = config.COS_BUCKET;
  const region = config.COS_REGION;

  cos.putBucketCors(
    {
      Bucket: bucket,
      Region: region,
      CORSConfiguration: {
        CORSRule: [
          {
            AllowedOrigin: ['*'],
            AllowedMethod: ['GET', 'HEAD', 'OPTIONS'],
            AllowedHeader: ['*'],
            ExposeHeader: ['ETag', 'Content-Length', 'x-cos-request-id'],
            MaxAgeSeconds: '3600',
          },
        ],
      },
    },
    (err, _data) => {
      if (err) {
        console.error(`❌ putBucketCors 失败: ${err.message ?? err.Code ?? err}`);
        process.exit(1);
      }
      console.log(`✅ CORS 已配置: GET/HEAD/OPTIONS 全来源(bucket=${bucket}, region=${region})`);
      cos.getBucketAcl({ Bucket: bucket, Region: region }, (aclErr, data) => {
        if (aclErr) {
          console.warn(`⚠️ 读取 ACL 失败: ${aclErr.message ?? aclErr.Code ?? aclErr}(可用控制台确认 bucket 为私有读写)`);
          return;
        }
        const acl = data.AccessControlList ?? '';
        console.log(`ACL 快照(含 owner 信息,请确认非 public-read): ${acl.slice(0, 200)}`);
      });
    },
  );
}

main();
