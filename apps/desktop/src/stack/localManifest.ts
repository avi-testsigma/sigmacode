/**
 * The stack as it runs from the checkouts on a developer machine, mirroring the
 * verified workbench. Phase 5 replaces this with a signed manifest fetched from
 * the bucket; until then it is decoded through the same schema.
 */
export const localManifest = {
  schemaVersion: 1,
  containers: [
    { name: "ts-postgres" },
    { name: "ts-mysql-8.1.0" },
    { name: "localstack_main" },
    { name: "redis-redis-1" },
    { name: "hazelcast1" },
    { name: "faktory" },
  ],
  services: [
    {
      id: "identity",
      cwd: "{src}/identity",
      run: ["./gradlew", "bootRun", "--console=plain"],
      env: {
        MYSQL_HOST_NAME: "127.0.0.1",
        MYSQL_PORT: "3306",
        MYSQL_USERNAME: "root",
        MYSQL_PASSWORD: "root",
      },
      port: 8084,
      health: { url: "http://127.0.0.1:8084/actuator/health", timeoutSec: 240 },
    },
    {
      id: "identity-ui",
      cwd: "{src}/identity-ui",
      run: ["pnpm", "dev"],
      port: 4220,
      health: { url: "http://127.0.0.1:4220/", timeoutSec: 120 },
    },
    {
      id: "sigma-svc",
      cwd: "{src}/behaviour-tree-ecosystem/packages/sigma-svc",
      run: ["{src}/behaviour-tree-ecosystem/node_modules/.bin/tsx", "src/main.ts"],
      env: { PORT: "7331" },
      port: 7331,
      health: { url: "http://127.0.0.1:7331/healthz", timeoutSec: 60 },
    },
    {
      id: "chitragupt",
      cwd: "{src}/chitragupt",
      build: {
        run: ["go", "build", "-o", "{bin}/chit-api", "./cmd/api"],
        output: "{bin}/chit-api",
      },
      run: ["{bin}/chit-api"],
      port: 8090,
      health: { url: "http://127.0.0.1:8090/public/ping", timeoutSec: 90 },
      preStart: [
        {
          fixer: "ssmAssert",
          endpoint: "http://localhost:4566",
          prefix: "/testsigma-arcus/development",
          values: {
            "database.master.database_name": "arcus_tms_master",
            "database.shard.0.database_name": "arcus_tms",
            "identity.host": "http://127.0.0.1:8084",
          },
        },
      ],
    },
    {
      id: "bt-agent",
      cwd: "{src}/behaviour-tree-ecosystem/apps/agent",
      run: ["{src}/behaviour-tree-ecosystem/node_modules/.bin/tsx", "src/index.ts"],
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3847" },
      port: 3847,
      health: { url: "http://127.0.0.1:3847/v1/health", timeoutSec: 90 },
    },
    {
      id: "guardians",
      cwd: "{src}/guardians",
      run: ["node_modules/.bin/next", "dev", "-p", "4300"],
      port: 4300,
      health: { url: "http://127.0.0.1:4300/ui", timeoutSec: 180 },
    },
  ],
} as const;
