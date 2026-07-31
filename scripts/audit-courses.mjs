#!/usr/bin/env node
/**
 * Standalone course audit. Reads data/normalized/courses.json and prints every
 * structural problem it finds. Exits non-zero on any error-severity issue.
 *
 * Usage:  node --experimental-strip-types scripts/audit-courses.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditCourses, formatCourseIssues } from './lib/audit-courses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const courses = JSON.parse(
  await readFile(path.join(ROOT, 'data', 'normalized', 'courses.json'), 'utf8'),
);

const { issues, checked } = auditCourses(courses);
const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

console.log(`course audit: ${checked} course(s) checked`);
console.log(`  errors   ${errors.length}`);
console.log(`  warnings ${warnings.length}`);
if (issues.length) console.log(formatCourseIssues(issues, 200));

process.exit(errors.length ? 1 : 0);
