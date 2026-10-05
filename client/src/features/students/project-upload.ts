import { handleUnauthorized } from '@/lib/queryClient';
import type { StudentProject } from '@shared/contracts/student-profile';

export function uploadStudentProject(studentId: number, title: string, file: File, onProgress: (percent: number) => void): Promise<StudentProject> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('title', title);
    form.append('fileName', file.name);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/academy/students/${studentId}/projects`);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.withCredentials = true;
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* A proxy may return HTML. */ }
      if (xhr.status >= 200 && xhr.status < 300 && typeof body.id === 'number') {
        onProgress(100); resolve(body as unknown as StudentProject);
      } else {
        if (xhr.status === 401) handleUnauthorized({ status: 401 });
        reject(Object.assign(new Error(String(body.error ?? 'studentProjectSaveFailed')), { status: xhr.status }));
      }
    };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => reject(new Error('studentProjectSaveFailed'));
    xhr.send(form);
  });
}
