/**
 * Why is no mail arriving?
 *
 *   npm run email:check                       # report the configuration
 *   npm run email:check -- --send you@x.com   # actually try to send one
 *
 * PRINTS NO SECRETS. Variable names and whether each is set — never a value.
 * Safe to run in production, safe to paste into an issue, safe to screenshot.
 *
 * The `--send` probe is the only honest way to answer "does mail work". It
 * makes a real request to the real provider and reports the real outcome,
 * including the provider's own error text: a wrong key, an unverified sending
 * domain and a blocked egress all look identical from the application side and
 * quite different here.
 */

import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const { describeEmailConfig } = await import('../lib/email/config');
const { createEmailService, resolveTransport } = await import('../lib/email/email-service');
const { EmailDeliveryError } = await import('../lib/email/transport');

const C = {
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
};

const report = describeEmailConfig();

console.log(C.bold('\nEmail configuration\n'));
console.log(`  provider          ${C.bold(report.provider)}`);
console.log(
  `  really delivers   ${report.delivers ? C.green('yes') : C.red('NO — nothing leaves this deployment')}`,
);
console.log(
  `  production ready  ${report.productionReady ? C.green('yes') : C.red('no')}`,
);
if (report.reason) console.log(`  reason            ${C.yellow(report.reason)}`);

console.log(C.bold('\nEnvironment variables') + C.dim('  (names and presence only — no values are read out)\n'));
for (const variable of report.variables) {
  const mark = variable.present ? C.green('set') : variable.required ? C.red('MISSING') : C.dim('unset');
  console.log(`  ${variable.name.padEnd(18)} ${mark.padEnd(20)} ${C.dim(variable.note)}`);
}

if (!report.delivers) {
  console.log(C.bold(C.yellow('\nNo mail is being sent.\n')));
  console.log(
    [
      '  The application is not failing — it is not configured. To send real mail:',
      '',
      `    1. Create an account at ${C.cyan('https://resend.com')} and add your sending domain.`,
      '    2. Add the DNS records it gives you (SPF, DKIM, and the return-path CNAME),',
      '       then wait for the domain to show as verified. Mail from an unverified',
      '       domain is refused with a 403, or silently filtered by the recipient.',
      '    3. Create an API key with send permission.',
      '    4. Put these in the environment (never in the repository):',
      '',
      '         RESEND_API_KEY=<the key>',
      '         EMAIL_FROM=Flyrlink <no-reply@yourdomain.com>',
      '         APP_URL=https://your-deployed-host',
      '',
      '    5. Re-run this command, then `npm run email:check -- --send you@yourdomain.com`.',
      '',
      C.dim('  Until then, development writes the link to the server console and says'),
      C.dim('  NOT SENT. Nothing pretends otherwise.'),
    ].join('\n'),
  );
}

// ---------------------------------------------------------------- live probe

const sendIndex = process.argv.indexOf('--send');
const recipient = sendIndex === -1 ? null : process.argv[sendIndex + 1];

if (sendIndex !== -1 && !recipient) {
  console.error(C.red('\n--send needs an address: npm run email:check -- --send you@example.com\n'));
  process.exit(2);
}

if (recipient) {
  console.log(C.bold(`\nSending a test message to ${recipient}\n`));
  const transport = resolveTransport();
  const service = createEmailService(transport);

  try {
    const result = await service.sendNotification({
      to: recipient,
      subject: 'Flyrlink email test',
      heading: 'Email delivery works',
      body: [
        'This message was sent by `npm run email:check -- --send`.',
        'If you are reading it, the provider, the API key and the sending domain are all correct.',
      ],
      tag: 'diagnostic',
    });

    if (result.status === 'SENT') {
      console.log(`  ${C.green('✓')}  accepted by ${result.transport}`);
      console.log(`     ${C.dim(`provider message id: ${result.messageId ?? '(none returned)'}`)}`);
      console.log(
        C.dim('\n  Accepted is not the same as delivered. Check the inbox, then the'),
      );
      console.log(C.dim("  provider's dashboard if it is not there — that is where a bounce shows.\n"));
    } else {
      console.log(`  ${C.red('✗')}  nothing was sent (${result.transport})`);
      console.log(`     ${C.yellow(result.reason)}\n`);
      process.exit(1);
    }
  } catch (error) {
    const isDelivery = error instanceof EmailDeliveryError;
    console.log(`  ${C.red('✗')}  the provider refused the message`);
    console.log(`     ${C.yellow(error instanceof Error ? error.message : String(error))}`);
    if (isDelivery && error.statusCode) {
      const hint: Record<number, string> = {
        401: 'The API key is wrong, revoked, or from a different account.',
        403: 'The sending domain is not verified for this account.',
        422: 'EMAIL_FROM is not an address this account is allowed to send from.',
        429: 'Rate limited. Wait and try again.',
      };
      console.log(`     ${C.dim(`HTTP ${error.statusCode}. ${hint[error.statusCode] ?? ''}`)}`);
    }
    console.log(
      C.dim(
        '\n  A connection failure here usually means outbound HTTPS to the provider\n' +
          '  is blocked by the network, not that the key is wrong.\n',
      ),
    );
    process.exit(1);
  }
}

console.log('');
