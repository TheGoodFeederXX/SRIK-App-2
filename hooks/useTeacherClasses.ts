import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ClassInfo, Subject } from '../types';
import { useAutoSync } from './useAutoSync';
import {
    getMyTeacherProfile,
    listAssignments,
    getTeacher,
    type AssignmentRecord,
} from '../src/lib/supabase/teachers';

export interface TeacherAssignment {
    classId: string;
    subjectId: string;
}

/**
 * The classes and subjects a teacher is responsible for, from the database.
 *
 * WHAT THIS HOOK USED TO DEPEND ON. It called `getMyTeacherProfileCached()`, which
 * went to `GET /teacher-profile/me` on the Express API, and it read `school_id` off
 * the result and off the signed-in user. Every one of those is gone: the API is not
 * deployed, and SRIK is one school with no school_id on any record.
 *
 * The consequence was not an error. `currentSchoolId` was null, the guard below
 * returned early, `loading` went false, and every teacher's dashboard showed zero
 * classes and an empty timetable — the app looking calm and simply empty, on the
 * first screen after login.
 *
 * It also filtered classes by branch, preferring the join row's branch over the
 * class's own. SRIK has no branches, so that filter could only ever pass everything
 * through unchanged.
 */
export const useTeacherClasses = (teacherId?: string | null) => {
    const { user: authUser } = useAuth();

    const [classes, setClasses] = useState<ClassInfo[]>([]);
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);

    const [resolvedTeacherId, setResolvedTeacherId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<any>(null);
    const [version, setVersion] = useState(0);
    const forceUpdate = () => setVersion(v => v + 1);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                // Who is this? Either the caller told us, or it is the signed-in
                // teacher's own record.
                let mine: AssignmentRecord[] = [];
                let id = teacherId ?? null;

                if (!id) {
                    const me = await getMyTeacherProfile().catch(() => null);
                    id = me?.id ?? null;
                }

                setResolvedTeacherId(id);
                if (!id) {
                    setClasses([]);
                    setSubjects([]);
                    setAssignments([]);
                    return;
                }

                // The teacher's duties for the current academic year.
                const all = await listAssignments().catch(() => [] as AssignmentRecord[]);
                mine = all.filter(a => a.teacherId === id);

                // Only the classes they actually teach. A class-teacher duty carries
                // no subject; those are still their class.
                const byId = new Map<string, ClassInfo>();
                const subjectById = new Map<string, Subject>();
                const assignmentList: TeacherAssignment[] = [];

                for (const a of mine) {
                    if (!byId.has(a.classId)) {
                        byId.set(a.classId, {
                            id: a.classId,
                            name: a.className,
                            // The class's year level, shown as the teacher's own
                            // "Form" wording.
                            grade: '',
                            section: '',
                            subject: a.subjectName ?? 'General',
                            studentCount: 0,
                        } as unknown as ClassInfo);
                    }

                    if (a.subjectId && a.subjectName) {
                        if (!subjectById.has(a.subjectId)) {
                            subjectById.set(a.subjectId, {
                                id: a.subjectId,
                                name: a.subjectName,
                                code: a.subjectName,
                            } as Subject);
                        }
                        assignmentList.push({ classId: a.classId, subjectId: a.subjectId });
                    }
                }

                setClasses([...byId.values()]);
                setSubjects([...subjectById.values()]);
                setAssignments(assignmentList);
            } catch (err) {
                console.error('[useTeacherClasses] could not load classes:', err);
                setError(err);
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [authUser?.id, teacherId, version]);

    useAutoSync(['teaching_assignments'], () => {
        forceUpdate();
    });

    // `schoolId` is still returned, because screens pass it around — but it is
    // always null now, and nothing should depend on it. Kept as an explicit
    // acknowledgement that the field exists in the UI layer's vocabulary rather
    // than silently changing the hook's shape.
    return {
        classes,
        subjects,
        assignments,
        loading,
        error,
        teacherId: resolvedTeacherId,
        schoolId: null as string | null,
    };
};
