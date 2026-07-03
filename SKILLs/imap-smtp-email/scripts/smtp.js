#!/usr/bin/env node

/**
 * SMTP Email CLI
 * Send email via SMTP protocol. Works with Gmail, Outlook, 163.com, and any standard SMTP server.
 * Supports attachments, HTML content, and multiple recipients.
 */

const nodemailer = require('nodemailer');
const path = require('path');
const {
  createSmtpConfig,
  getTargetAccounts,
  listAccountsConfig,
  redactAccount,
  redactEmail,
} = require('./config');

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      options[key] = value || true;
      if (value && !value.startsWith('--')) i++;
    } else {
      positional.push(arg);
    }
  }

  return { command, options, positional };
}

// Create SMTP transporter
function createTransporter(account) {
  const config = createSmtpConfig(account);
  console.error(`[smtp-debug] Account: ${JSON.stringify(redactAccount(account))}`);
  console.error(`[smtp-debug] Config: host=${config.host}, port=${config.port}, user=${redactEmail(config.auth.user)}, secure=${config.secure}, rejectUnauthorized=${config.tls.rejectUnauthorized}, hasPassword=${!!config.auth.pass}`);

  return nodemailer.createTransport(config);
}

// Send email
async function sendEmail(account, options) {
  if (account.requireSendConfirmation !== false && options.confirmed !== true && options.confirmed !== 'true') {
    return {
      success: false,
      code: 'confirmation_required',
      message: 'Email sending requires explicit confirmation. Re-run with --confirmed after the user confirms recipients, subject, account, and body.',
      accountId: account.id,
      accountName: account.name,
      from: options.from || account.smtpFrom || account.email,
      to: options.to,
      subject: options.subject || '(no subject)',
    };
  }

  const transporter = createTransporter(account);

  // Verify connection
  try {
    await transporter.verify();
    console.error('SMTP server is ready to send');
  } catch (err) {
    throw new Error(`SMTP connection failed: ${err.message}`);
  }

  const mailOptions = {
    from: options.from || account.smtpFrom || account.email,
    to: options.to,
    cc: options.cc || undefined,
    bcc: options.bcc || undefined,
    subject: options.subject || '(no subject)',
    text: options.text || undefined,
    html: options.html || undefined,
    attachments: options.attachments || [],
  };

  // If neither text nor html provided, use default text
  if (!mailOptions.text && !mailOptions.html) {
    mailOptions.text = options.body || '';
  }

  const info = await transporter.sendMail(mailOptions);

  return {
    success: true,
    accountId: account.id,
    accountName: account.name,
    messageId: info.messageId,
    response: info.response,
    to: mailOptions.to,
  };
}

// Read file content for attachments
function readAttachment(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Attachment file not found: ${filePath}`);
  }
  return {
    filename: path.basename(filePath),
    path: path.resolve(filePath),
  };
}

// Send email with file content
async function sendEmailWithContent(account, options) {
  // Handle attachments
  if (options.attach) {
    const attachFiles = options.attach.split(',').map(f => f.trim());
    options.attachments = attachFiles.map(f => readAttachment(f));
  }

  return await sendEmail(account, options);
}

// Test SMTP connection
async function testConnection(account) {
  const transporter = createTransporter(account);

  try {
    await transporter.verify();
    const info = await transporter.sendMail({
      from: account.smtpFrom || account.email,
      to: account.email, // Send to self
      subject: 'SMTP Connection Test',
      text: 'This is a test email from the IMAP/SMTP email skill.',
      html: '<p>This is a <strong>test email</strong> from the IMAP/SMTP email skill.</p>',
    });

    return {
      success: true,
      accountId: account.id,
      accountName: account.name,
      message: 'SMTP connection successful',
      messageId: info.messageId,
    };
  } catch (err) {
    throw new Error(`SMTP test failed: ${err.message}`);
  }
}

// Verify SMTP connection without sending email
async function verifyConnection(account) {
  const transporter = createTransporter(account);

  try {
    console.error('[smtp-debug] Verifying SMTP connection...');
    await transporter.verify();
    console.error('[smtp-debug] SMTP verification succeeded');
    return {
      success: true,
      accountId: account.id,
      accountName: account.name,
      message: 'SMTP verification successful',
    };
  } catch (err) {
    console.error('[smtp-debug] SMTP verify failed:', err.message, 'code:', err.code, 'responseCode:', err.responseCode);
    throw new Error(`SMTP verify failed: ${err.message}`);
  }
}

// Main CLI handler
async function main() {
  const { command, options, positional } = parseArgs();

  try {
    let result;
    let account;

    switch (command) {
      case 'accounts':
        result = listAccountsConfig();
        break;

      case 'send':
        if (options['all-accounts']) {
          throw new Error('--all-accounts is not supported for send; pass --account <id>');
        }
        account = getTargetAccounts(options).accounts[0];
        if (!options.to) {
          throw new Error('Missing required option: --to <email>');
        }
        if (!options.subject && !options['subject-file']) {
          throw new Error('Missing required option: --subject <text> or --subject-file <file>');
        }

        // Read subject from file if specified
        if (options['subject-file']) {
          const fs = require('fs');
          options.subject = fs.readFileSync(options['subject-file'], 'utf8').trim();
        }

        // Read body from file if specified
        if (options['body-file']) {
          const fs = require('fs');
          const content = fs.readFileSync(options['body-file'], 'utf8');
          if (options['body-file'].endsWith('.html') || options.html) {
            options.html = content;
          } else {
            options.text = content;
          }
        } else if (options['html-file']) {
          const fs = require('fs');
          options.html = fs.readFileSync(options['html-file'], 'utf8');
        } else if (options.body) {
          options.text = options.body;
        }

        result = await sendEmailWithContent(account, options);
        break;

      case 'test':
        if (options['all-accounts']) {
          throw new Error('--all-accounts is not supported for test; pass --account <id>');
        }
        account = getTargetAccounts(options).accounts[0];
        result = await testConnection(account);
        break;

      case 'verify':
        if (options['all-accounts']) {
          throw new Error('--all-accounts is not supported for verify; pass --account <id>');
        }
        account = getTargetAccounts(options).accounts[0];
        result = await verifyConnection(account);
        break;

      default:
        console.error('Unknown command:', command);
        console.error('Available commands: accounts, send, test, verify');
        console.error('\nUsage:');
        console.error('  accounts List configured accounts without secrets');
        console.error('  send   --to <email> --subject <text> [--body <text>] [--html] [--cc <email>] [--bcc <email>] [--attach <file>]');
        console.error('  send   --to <email> --subject <text> --body-file <file> [--html-file <file>] [--attach <file>]');
        console.error('  test   Test SMTP connection');
        console.error('  verify Verify SMTP connection without sending email');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
