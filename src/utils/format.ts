import chalk from 'chalk';
import { JiraIssue } from '../config/types';
import { formatSeconds } from './time';

export function issueTypeIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('epic'))    return chalk.magenta('⬡');
  if (t.includes('story'))   return chalk.green('◆');
  if (t.includes('bug'))     return chalk.red('●');
  if (t.includes('task'))    return chalk.blue('■');
  if (t.includes('subtask') || t.includes('sub-task')) return chalk.dim('└');
  if (t.includes('qa') || t.includes('test')) return chalk.cyan('◉');
  return chalk.dim('·');
}

export function formatIssue(issue: JiraIssue, baseUrl: string): string {
  const { key, fields } = issue;
  const url = `${baseUrl}/browse/${key}`;
  const icon = issueTypeIcon(fields.issuetype?.name ?? '');

  const lines = [
    `${icon} ${chalk.bold.cyan(`[${key}]`)} ${fields.summary}`,
    `${chalk.gray('Tipo:')}      ${fields.issuetype?.name ?? '—'}`,
    `${chalk.gray('Estado:')}    ${statusColor(fields.status.name)}`,
    `${chalk.gray('Asignado:')} ${fields.assignee?.displayName ?? chalk.dim('Sin asignar')}`,
    `${chalk.gray('Fecha:')}     ${fields.duedate ?? chalk.dim('Sin fecha')}`,
    `${chalk.gray('Estimado:')} ${fields.timeoriginalestimate ? formatSeconds(fields.timeoriginalestimate) : chalk.dim('—')}`,
    chalk.underline.blue(url),
  ];

  if (fields.parent) {
    lines.splice(1, 0, `${chalk.gray('Padre:')}     [${fields.parent.key}] ${fields.parent.fields.summary}`);
  }

  return lines.join('\n');
}

export function formatIssueRow(issue: {
  key: string;
  summary: string;
  status: string;
  issueType?: string;
}, baseUrl: string): string {
  const icon = issueTypeIcon(issue.issueType ?? '');
  return [
    `${icon} ${chalk.bold.cyan(`[${issue.key}]`)} ${issue.summary}`,
    `   ${chalk.gray('Estado:')} ${statusColor(issue.status)}`,
    `   ${chalk.underline.blue(`${baseUrl}/browse/${issue.key}`)}`,
    '',
  ].join('\n');
}

function statusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes('finaliz') || lower.includes('done') || lower.includes('closed') || lower.includes('resolved')) {
    return chalk.green(status);
  }
  if (lower.includes('progress') || lower.includes('curso') || lower.includes('review') || lower.includes('revisión')) {
    return chalk.yellow(status);
  }
  if (lower.includes('staging') || lower.includes('ready') || lower.includes('testing') || lower.includes('qa')) {
    return chalk.magenta(status);
  }
  if (lower.includes('todo') || lower.includes('hacer') || lower.includes('backlog') || lower.includes('open')) {
    return chalk.gray(status);
  }
  return chalk.white(status);
}

export function success(msg: string): void {
  console.log(chalk.green('✓') + ' ' + msg);
}

export function info(msg: string): void {
  console.log(chalk.cyan('ℹ') + ' ' + msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠') + ' ' + msg);
}

export function error(msg: string): void {
  console.error(chalk.red('✗') + ' ' + msg);
}
