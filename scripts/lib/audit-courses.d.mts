export interface CourseAuditIssue {
  severity: 'error' | 'warning';
  courseId: number;
  course: string;
  check: string;
  detail: string;
}

export function auditCourses(courses: unknown[]): {
  issues: CourseAuditIssue[];
  checked: number;
};

export function formatCourseIssues(issues: CourseAuditIssue[], limit?: number): string;
