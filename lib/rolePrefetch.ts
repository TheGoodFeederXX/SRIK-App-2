type Role = string;
type Importer = () => Promise<unknown>;

const PREFETCHERS: Record<string, Importer[]> = {
    ADMIN: [
        () => import('../components/admin/StudentListScreen'),
        () => import('../components/admin/TeacherListScreen'),
        () => import('../components/admin/ClassListScreen'),
        () => import('../components/admin/AttendanceOverviewScreen'),
        () => import('../components/admin/TimetableScreen'),
    ],
    TEACHER: [
        () => import('../components/teacher/ClassDetailScreen'),
        () => import('../components/teacher/TeacherUnifiedAttendanceScreen'),
        () => import('../components/admin/TimetableScreen'),
        () => import('../components/teacher/LessonNotesUploadScreen'),
        () => import('../components/teacher/TeacherMessagesScreen'),
    ],
    PARENT: [
        () => import('../components/student/AttendanceScreen'),
        () => import('../components/admin/TimetableScreen'),
        () => import('../components/parent/ParentMessagesScreen'),
    ],
};

const ROLE_ALIASES: Record<string, string> = {
    admin: 'ADMIN',
    teacher: 'TEACHER',
    student: 'STUDENT',
    parent: 'PARENT',
};

export function prefetchRoleChunks(role: Role): () => void {
    let cancelled = false;
    let nextIndex = 0;
    const key = ROLE_ALIASES[String(role).toLowerCase()] || String(role).toUpperCase();
    const tasks = PREFETCHERS[key] || [];
    const concurrency = 2;
    const active = new Set<Promise<unknown>>();

    if (typeof window !== 'undefined') {
        (window as any).__ROLE_PREFETCH__ = { role: key, started: true, completed: 0, total: tasks.length };
    }

    const pump = () => {
        if (cancelled) return;
        while (active.size < concurrency && nextIndex < tasks.length) {
            const task = tasks[nextIndex++]();
            const promise = task
                .catch(() => undefined)
                .finally(() => {
                    active.delete(promise);
                    if (typeof window !== 'undefined') {
                        const state = (window as any).__ROLE_PREFETCH__;
                        if (state) state.completed += 1;
                    }
                });
            active.add(promise);
        }
        if (nextIndex < tasks.length && active.size > 0) Promise.race(active).then(pump);
    };

    pump();
    return () => { cancelled = true; };
}
