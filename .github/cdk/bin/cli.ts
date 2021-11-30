#!/usr/bin/env node
import { Command } from "commander";

import type { CleanupParams } from "../lib/cleanup";
import cleanup from "../lib/cleanup";
import type { DeployParams } from "../lib/deploy";
import deploy from "../lib/deploy";
import type { DestroyParams } from "../lib/destroy";
import destroy from "../lib/destroy";
import { slugify } from "../util/slugify";
import { Telegram } from "telegram-send";

const program = new Command();

process.on("unhandledRejection", (err) => {
  console.trace(err);
  process.exitCode = 1;
});

program.description("Manage CDK Stacks for static site deploys");

export type TelegramNotification = {
  telegramChatId?: string;
  telegramToken?: string;
  telegramMessage?: string;
};

program
  .command("deploy")
  .description("Create or update a CDK Frontend Stack")
  .requiredOption(
    "-s, --stackName <stackName>",
    "Stack name in CloudFormation (tweak-columns-www)"
  )
  .requiredOption("-k, --product <product>", "Product name (www)")
  .requiredOption(
    "-l, --environment <environment>",
    "Environment (tweak-columns)"
  )
  .requiredOption("-m, --repository <repository>", "Repository (frontend)")
  .requiredOption("-z, --zoneId <zoneId>", "Route53 Domain ZoneID")
  .requiredOption("-y, --zoneDomain <zoneDomain>", "Route53 Root Domain name")
  .requiredOption("-d, --subDomain <subDomain>", "Route53 subdomain")
  .requiredOption("-b, --bucketName <bucketName>", "S3 Bucket Name")
  .requiredOption("-a, --certificateArn <certificateArn>", "SSL Cert ARN")
  .requiredOption("-o, --originPath <originPath>", "Folder to use in S3 bucket")
  .requiredOption(
    "-p, --buildPath <buildPath>",
    "Local folder with the assets to upload"
  )
  .option("-f, --additionalMapping <additionalMapping>")
  .option(
    "-l, --lambdaEdgesPath <lambdaEdgesPath>",
    "Folder with lambda@edge functions"
  )
  .option("-e, --envPrefix <envPrefix>", "Frontend env prefix")
  .option("-i, --telegramChatId <telegramChatId>", "telegramChatId")
  .option("-t, --telegramToken <telegramToken>", "telegramToken")
  .option("-t, --telegramMessage <telegramMessage>", "telegramMessage")
  .action(async (params: DeployParams & TelegramNotification) => {
    await deploy(params);
    if (
      params.telegramChatId &&
      params.telegramToken &&
      params.telegramMessage
    ) {
      console.log(params.telegramMessage)
      const tg = new Telegram(params.telegramToken, params.telegramChatId);
      tg.send(params.telegramMessage);
    }
  });

program
  .command("delete")
  .description("Delete CDK Frontend Stack")
  .requiredOption("-s, --stackName <stackName>", "Stack name in CloudFormation")
  .requiredOption("-b, --bucketName <bucketName>", "S3 Bucket Name")
  .requiredOption("-o, --originPath <originPath>", "Folder used in S3 bucket")
  .option("-i, --telegramChatId <telegramChatId>", "telegramChatId")
  .option("-t, --telegramToken <telegramToken>", "telegramToken")
  .option("-t, --telegramMessage <telegramMessage>", "telegramMessage")
  .action(async (params: DestroyParams & TelegramNotification) => {
    await destroy(params);
    if (
      params.telegramChatId &&
      params.telegramToken &&
      params.telegramMessage
    ) {
      console.log(params.telegramMessage)
      const tg = new Telegram(params.telegramToken, params.telegramChatId);
      tg.send(params.telegramMessage);
    }
  });

program
  .command("cleanup")
  .description("Cleanup CDK Frontend Stack")
  .requiredOption(
    "-s, --existingBranches <existingBranches>",
    "Existing git branches"
  )
  .requiredOption("-p, --repository <repository>", "Repository (frontend)")
  .action(
    async ({
      existingBranches,
      ...rest
    }: CleanupParams & { existingBranches: string }) => {
      const filteredBranches = existingBranches
        .split(" ")
        .map((branch) => branch.replace("\\n", "").replace("origin/", ""));

      const productBranches = filteredBranches
        .map((branch) => slugify(branch))
        .filter((branch) => branch);

      await cleanup({ ...rest, productBranches });
    }
  );

program.parse(process.argv);
