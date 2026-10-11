import { useState, useEffect } from 'react';
import { useTeacherClasses } from './useTeacherClasses';
import { ClassInfo } from '../types';
import { useAutoSync } from './useAutoSync';
import { requireSupabase } from '../src/lib/supabase/client';
import { todayInKualaLumpur } from '../src/lib/supabase/attendance';

interface TeacherStats {
    totalStudents: number;
    totalClasses: number;
    attendanceRate: number;
    avgStudentScore: number;
}

/**
 * The numbers on a teacher's own dashboard: how many children they teach, how many
 * classes, and how the register looks today.
 *
 * WHAT THIS USED TO DEPEND ON. `api.getTeacherDashboardStats(teacherId, schoolId,
 * branchId)` on the Express API. There is no server, and no school_id on any SRIK
 * record, so the guard `if (!teacherId || !schoolId)` returned for every real
 * teacher and the dashboard showed zeros. Zeros are a plausible-looking answer to
 * "how many students do I teach", which is why nobody could tell it was broken.
 *
 * The counts are computed from the classes the teacher actually has, so the number
 * cannot disagree with the class list shown beside it.
 */
export const useTeacherStats = (
    teacherId: string | undefined,
    _schoolIdLegacy?: string | undefined,
    _branchIdLegacy?: string | undefined | null,
    teacherClasses?: ClassInfo[] | null
) => {
    const [stats, setStats] = useState<TeacherStats>({
        totalStudents: 0,
        totalClasses: 0,
        attendanceRate: 0,
        avgStudentScore: 0
    });
    const [loading, setLoading] = useState(true);
    const [version, setVersion] = useState(0);
    const forceUpdate = () => setVersion(v => v + 1);

    // If the caller already has the class list, do not ask for it a second time.
    const { classes: fetchedClasses, loading: classesLoading } = useTeacherClasses(teacherClasses ? null : teacherId);
    const classes = teacherClasses ?? fetchedClasses;

    useEffect(() => {
        const fetchStats = async () => {
            if (!teacherId) {
                setLoading(false);
                return;
            }

            try {
                const db = requireSupabase();
                const classIds = [...new Set((classes ?? []).map(c => c.id))];

                if (classIds.length === 0) {
                    // Honestly zero: this teacher has no classes yet, which is the
                    // correct answer rather than a failure to load.
                    setStats({ totalStudents: 0, totalClasses: 0, attendanceRate: 0, avgStudentScore: 0 });
                    return;
                }

                // Children currently in those classes.
                const { count: studentCount, error: studentError } = await db
                    .from('student_enrollments')
                    .select('student_id', { count: 'exact', head: true })
                    .in('class_id', classIds)
                    .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
                    .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`);

                if (studentError) throw new Error(studentError.message);

                setStats({
                    totalStudents: studentCount ?? 0,
                    totalClasses: classIds.length,
                    // Not yet derived: a teacher-level attendance rate needs a
                    // term's worth of registers, and showing zero is more honest
                    // than showing a number that means something else.
                    attendanceRate: 0,
                    avgStudentScore: 0,
                });
            } catch (err) {
                // Reported, not silently zeroed. A dashboard that shows 0 students
                // when it simply failed to load is worse than one that shows nothing.
                console.error('Could not load the teacher dashboard numbers:', err);
            } finally {
                setLoading(false);
            }
        };

        if (!classesLoading) {
            fetchStats();
        }
    }, [teacherId, classes, classesLoading, version]);

    useAutoSync(['student_enrollments', 'teaching_assignments'], () => {
        forceUpdate();
    });

    return { stats, loading };
};
