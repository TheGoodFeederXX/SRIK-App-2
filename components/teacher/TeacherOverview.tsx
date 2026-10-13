import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import AIInsightsPanel from '../shared/AIInsightsPanel';
import {
  BookOpenIcon,
  ChevronRightIcon,
  ViewGridIcon,
  TeacherAttendanceIcon,
  ClipboardListIcon,
  BriefcaseIcon,
  SparklesIcon,
  CalendarPlusIcon,
  VideoIcon,
  CheckCircleIcon,
  EditIcon,
  CalculatorIcon,
  ChartBarIcon,
  SUBJECT_COLORS,
  UserGroupIcon,
  ElearningIcon,
  getFormattedClassName
} from '../../constants';
import { DashboardType } from '../../types';
import { THEME_CONFIG } from '../../constants';
import { useTeacherStats } from '../../hooks/useTeacherStats';
import { useTeacherClasses } from '../../hooks/useTeacherClasses';
import { useAutoSync } from '../../hooks/useAutoSync';
import { listAssignments, getTeacherDuties } from '../../src/lib/supabase/teachers';
import type { EntryRecord } from '../../src/lib/supabase/timetable';
import { getActiveTimetable, getTeacherTimetable, listPeriods } from '../../src/lib/supabase/timetable';
import { loadSchedule } from '../../lib/timetableSchedule';
import { toSchoolDayEnum } from '../../src/lib/branding';

interface TeacherOverviewProps {
  navigateTo: (view: string, title: string, props?: any) => void;
  currentUser?: any;
  profile?: any;
  teacherProfile?: any;
  teacherId?: string | null;
  schoolId: string;
  currentBranchId: string | null;
}

const StatCard: React.FC<{ label: string; value: string | number; icon: React.ReactElement<{ className?: string }>; }> = ({ label, value, icon }) => {
  const theme = THEME_CONFIG[DashboardType.Teacher];
  return (
    <div className={`${theme.cardBg} p-3 sm:p-4 rounded-xl flex items-center space-x-3`}>
      <div className={`${theme.cardIconBg} p-1.5 sm:p-2 rounded-full flex-shrink-0 shrink-0`}>
        {React.cloneElement(icon, { className: `h-5 w-5 sm:h-6 sm:w-6 ${theme.iconColor}` })}
      </div>
      <div className="min-w-0">
        <p className={`text-xl sm:text-2xl font-bold ${theme.textColor} truncate`}>{value}</p>
        <p className="text-xs sm:text-sm text-gray-600 leading-snug">{label}</p>
      </div>
    </div>
  );
};

const parseClassName = (name: string) => {
  const clean = name.trim();
  let grade = 0;
  let section = '';
  const standardMatch = clean.match(/^(?:Grade|Year)?\s*(\d+)\s*(.*)$/i);
  const jsMatch = clean.match(/^JSS\s*(\d+)\s*(.*)$/i);
  const ssMatch = clean.match(/^S{2,3}\s*(\d+)\s*(.*)$/i);
  const primaryMatch = clean.match(/^Primary\s*(\d+)\s*(.*)$/i);

  if (standardMatch) {
    grade = parseInt(standardMatch[1]);
    section = standardMatch[2];
  } else if (jsMatch) {
    grade = 6 + parseInt(jsMatch[1]);
    section = jsMatch[2];
  } else if (ssMatch) {
    grade = 9 + parseInt(ssMatch[1]);
    section = ssMatch[2];
  } else if (primaryMatch) {
    grade = parseInt(primaryMatch[1]);
    section = primaryMatch[2];
  }
  section = section.replace(/^[-–]\s*/, '').trim();
  return { grade, section };
};

const TeacherOverview: React.FC<TeacherOverviewProps> = ({ navigateTo, currentUser, profile, teacherProfile, teacherId, schoolId, currentBranchId }) => {
    const { t } = useTranslation();
  const theme = THEME_CONFIG[DashboardType.Teacher];

  const { classes: teacherClasses, loading: classesLoading, teacherId: resolvedTeacherId, schoolId: resolvedSchoolId } = useTeacherClasses(teacherId);
  const { stats, loading: statsLoading } = useTeacherStats(resolvedTeacherId || teacherId || currentUser?.id, resolvedSchoolId || schoolId, currentBranchId, teacherClasses);

  const [todaySchedule, setTodaySchedule] = useState<any[]>([]);
  const [ungradedAssignments, setUngradedAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const forceUpdate = () => setVersion(v => v + 1);

  // Class Teacher / Subject Teacher role assignments — drives the adaptive
  // badges and the "My Class" quick action below.
  const [myRoles, setMyRoles] = useState<{ roles: string[]; class_teacher_of: any[]; subject_assignments: any[] }>({
    roles: [], class_teacher_of: [], subject_assignments: [],
  });
  // Re-read on every refresh signal (`version` bumps on realtime events and on
  // the polling fallback used where there is no socket): an admin assigning
  // this teacher as Class Teacher used to stay invisible until a full reload.
  // Whether this teacher is a class teacher or a subject teacher, from the
  // teaching assignments themselves.
  //
  // This was `GET /teacher-assignments/mine/roles` against the Express API. There
  // is no server, so the request failed and the catch swallowed it — the badges
  // stayed empty forever and nothing reported why. The duties are in
  // `teaching_assignments`, which the frontend can already read.
  useEffect(() => {
    const id = resolvedTeacherId || teacherId;
    if (!id) return;

    getTeacherDuties(id)
      .then(() => listAssignments())
      .then(all => {
        const mine = all.filter(a => a.teacherId === id);
        const roles: string[] = [];
        if (mine.some(a => a.type === 'CLASS_TEACHER')) roles.push('class_teacher');
        if (mine.some(a => a.type === 'SUBJECT_TEACHER')) roles.push('subject_teacher');
        setMyRoles({
          roles,
          class_teacher_of: mine.filter(a => a.type === 'CLASS_TEACHER').map(a => ({ class_id: a.classId, class_name: a.className })),
          subject_assignments: mine.filter(a => a.type === 'SUBJECT_TEACHER').map(a => ({ class_id: a.classId, subject: a.subjectName })),
        });
      })
      .catch(() => { /* non-fatal — badges just stay empty */ });
  }, [version, resolvedTeacherId, teacherId]);
  const isClassTeacher = myRoles.roles.includes('class_teacher');
  const isSubjectTeacher = myRoles.roles.includes('subject_teacher');

  // Live clock — refreshes every minute so the schedule reacts to time changes
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

    useEffect(() => {
        const fetchData = async () => {
            const actualTeacherId = resolvedTeacherId || teacherId;

            // ONLY the teacher is required. The gate used to be
            // `if (!actualSchoolId || !actualTeacherId) return;`, and since SRIK has
            // no school id on any record, that returned for every real teacher. The
            // dashboard rendered its empty state as though there were simply no
            // lessons today.
            if (!actualTeacherId) return;

            try {
                setLoading(true);

                // The teacher's own week, from the database.
                //
                // This used to be `api.getTimetable(...)` and `api.getAssignments(...)`
                // against the Express API, gated on a `schoolId` SRIK does not have.
                // So the guard below returned early for every real teacher and the
                // dashboard showed an empty schedule — on the FIRST screen of the app,
                // with nothing to indicate anything had gone wrong.
                const timetable = await getActiveTimetable();
                const [periods, scheduleRes, assignmentsRes] = await Promise.all([
                    timetable ? listPeriods(timetable.id) : Promise.resolve([]),
                    timetable
                        ? getTeacherTimetable(timetable.id, actualTeacherId)
                        : Promise.resolve({ entries: [] as EntryRecord[] }),
                    listAssignments(),
                ]);

                // "Today's Schedule" = this teacher's lessons for the current
                // weekday, with the clock time that belongs to each period.
                //
                // The day is compared by NAME. `day_of_week` holds 'SUNDAY' …
                // 'THURSDAY', and the previous code computed a number 1..7 and
                // compared it to that column — so the comparison could never be true
                // and Today's Schedule was empty every day of the week, with no
                // error to show for it.
                const todayEnum = toSchoolDayEnum(new Date());

                const todays = (scheduleRes.entries ?? [])
                    .filter((e: any) => {
                        const p = periods.find(x => x.id === e.periodId);
                        return p ? p.dayOfWeek === todayEnum : false;
                    })
                    .map((e: any) => {
                        const p = periods.find(x => x.id === e.periodId);
                        return {
                            id: e.id,
                            class_id: e.classId,
                            class_name: e.className,
                            subject: e.subjectName ?? e.activity ?? '',
                            start_time: p?.startTime ?? '',
                            end_time: p?.endTime ?? '',
                            room: e.room,
                        };
                    })
                    .filter((e: any) => e.start_time)
                    .sort((a: any, b: any) => String(a.start_time).localeCompare(String(b.start_time)));

                setTodaySchedule(todays);

                // The teacher's own assignments, newest first — the three they would
                // most likely want to look at.
                const mine = (assignmentsRes || []).filter((a: any) => a.teacherId === actualTeacherId);
                setUngradedAssignments(mine.slice(0, 3));
            } catch (err) {
                console.error('❌ Error fetching overview data:', err);
            } finally {
                setLoading(false);
            }
        };

        if (!classesLoading && resolvedTeacherId) {
            fetchData();
        }
    }, [resolvedTeacherId, resolvedSchoolId, classesLoading, currentBranchId, version]);

    const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useAutoSync(
      ['assignments', 'timetable', 'students', 'teachers', 'classes', 'teacher_classes', 'class_teachers', 'report_cards'],
      () => {
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }
        syncTimeoutRef.current = setTimeout(() => {
          forceUpdate();
          syncTimeoutRef.current = null;
        }, 2000);
      }
    );

  const formatTime12Hour = (timeStr: string) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    let h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${h}:${minutes} ${ampm}`;
  };

  // "08:45" → 525 (minutes since midnight)
  const timeToMins = (t: string) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  // Recomputes every minute via the `now` dependency
  const scheduleStatus = useMemo(() => {
    const day = now.getDay(); // 0=Ahad … 6=Sabtu
    // The school week is Sunday to Thursday, so the days WITHOUT school are
    // Friday and Saturday — not Sunday. Treating Sunday as a weekend told a
    // teacher on a working day that there was no school today, and would have
    // shown no classes on a day they were teaching.
    if (day === 5 || day === 6) return { type: 'weekend' as const };
    if (todaySchedule.length === 0) return { type: 'no_classes' as const };

    const nowMins = now.getHours() * 60 + now.getMinutes();
    const first = todaySchedule[0];
    const last  = todaySchedule[todaySchedule.length - 1];

    // Before the first lesson of the day
    if (nowMins < timeToMins(first.start_time)) {
      return { type: 'before_school' as const, next: first };
    }

    // After school ends (last lesson's end_time, or +45 min from start if missing)
    const lastEnd = timeToMins(last.end_time || '') || timeToMins(last.start_time) + 45;
    if (nowMins >= lastEnd) return { type: 'after_school' as const };

    // Walk the periods to find current / break / next
    for (let i = 0; i < todaySchedule.length; i++) {
      const e = todaySchedule[i];
      const start = timeToMins(e.start_time);
      const end   = timeToMins(e.end_time || '') || start + 45;

      if (nowMins >= start && nowMins < end) {
        return { type: 'in_class' as const, current: e, currentIdx: i };
      }
      if (i < todaySchedule.length - 1) {
        const next = todaySchedule[i + 1];
        const nextStart = timeToMins(next.start_time);
        if (nowMins >= end && nowMins < nextStart) {
          return { type: 'break' as const, next };
        }
      }
    }
    return { type: 'after_school' as const };
  }, [now, todaySchedule]);

  const atRiskIcon = <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;

  const quickActionGroups = [
    {
      title: t('teacherOverview.teaching'),
      items: [
        // Class Teacher only — the class-wide management hub.
        ...(isClassTeacher ? [{
          label: t('teacherOverview.myClass'), icon: <UserGroupIcon className="h-7 w-7" />,
          action: () => navigateTo('myClassHub', t('teacherOverview.myClass'), { teacherId, schoolId, currentBranchId, classId: myRoles.class_teacher_of[0]?.id })
        }] : []),
        { label: t('teacherOverview.attendance'), icon: <TeacherAttendanceIcon className="h-7 w-7" />, action: () => navigateTo('selectClassForAttendance', t('teacherOverview.selectClass'), { teacherId, schoolId }) },
        { label: t('teacherOverview.myAttendance'), icon: <CheckCircleIcon className="h-7 w-7" />, action: () => navigateTo('teacherSelfAttendance', t('teacherOverview.myAttendance'), { teacherId }) },
        { label: t('teacherOverview.gradebook'), icon: <CalculatorIcon className="h-7 w-7" />, action: () => navigateTo('classGradebook', t('teacherOverview.classGradebook'), { teacherId }) },
        { label: "Exams", icon: <ClipboardListIcon className="h-7 w-7" />, action: () => navigateTo('examManagement', t('teacherOverview.manageExams'), { schoolId, teacherId, branchId: currentBranchId }) },
        { label: t('teacherOverview.assessments'), icon: <ClipboardListIcon className="h-7 w-7" />, action: () => navigateTo('assessmentsHub', t('teacherOverview.assessmentsQuizzes'), { teacherId, branchId: currentBranchId }) },
        { label: t('teacherOverview.aiPlanner'), icon: <SparklesIcon className="h-7 w-7" />, action: () => navigateTo('lessonPlanner', t('teacherOverview.aiLessonPlanner'), { teacherId }) },
        { label: t('teacherOverview.lessonNotes'), icon: <BookOpenIcon className="h-7 w-7" />, action: () => navigateTo('lessonNotesUpload', t('teacherOverview.uploadLessonNotes'), { teacherId }) },
        // "Reports" removed: already a direct nav item on both desktop (sidebar) and mobile (bottom nav).
      ],
    },
    {
      title: t('teacherOverview.students'),
      items: [
        { label: t('teacherOverview.addStudent'), icon: <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>, action: () => navigateTo('addStudent', t('teacherOverview.addStudent'), { schoolId }) },
        { label: t('teacherOverview.atRiskStudents'), icon: atRiskIcon, action: () => navigateTo('myAtRiskStudents', t('teacherOverview.atRiskStudents')) },
        { label: t('teacherOverview.observationFeedback'), icon: <ClipboardListIcon className="h-7 w-7" />, action: () => navigateTo('myObservations', t('teacherOverview.classroomObservationFeedback')) },
        { label: t('teacherOverview.studentGate'), icon: <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>, action: () => navigateTo('studentGate', t('teacherOverview.studentDeparture')) },
      ],
    },
    {
      title: t('teacherOverview.communication'),
      items: [
        { label: t('teacherOverview.appointments'), icon: <CalendarPlusIcon className="h-7 w-7" />, action: () => navigateTo('appointments', t('teacherOverview.appointments'), { teacherId }) },
        { label: t('teacherOverview.virtualClass'), icon: <VideoIcon className="h-7 w-7" />, action: () => navigateTo('virtualClass', t('teacherOverview.virtualClassroom'), { teacherId, schoolId }) },
        // "Forum" removed: duplicates the Forum link already in both the
        // sidebar and the mobile bottom nav.
      ],
    },
    {
      title: t('teacherOverview.supportResources'),
      items: [
        { label: t('teacherOverview.myFile'), icon: <BriefcaseIcon className="h-7 w-7" />, action: () => navigateTo('myPersonnelFile', t('teacherOverview.myPersonnelFile'), { teacherId }) },
        { label: t('teacherOverview.scanClassroom'), icon: <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10" /></svg>, action: () => navigateTo('scanClassroom', t('teacherOverview.scanClassroom'), { teacherId }) },
        { label: t('teacherOverview.substituteRequests'), icon: <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" /></svg>, action: () => navigateTo('substituteAssignments', t('teacherOverview.substituteAssignments')) },
        // "Resources" folded into Learning Hub below — AI Lesson Planner already
        // has its own tile above; E-Learning Library and Educational Games are
        // now quick-links inside the Learning Hub screen instead of a separate hub.
        { label: t('teacherOverview.learningHub'), icon: <ElearningIcon className="h-7 w-7" />, action: () => navigateTo('learningHub', t('teacherOverview.learningHub'), { teacherId, schoolId }) },
        { label: t('teacherOverview.reportIncident'), icon: <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>, action: () => navigateTo('mySopCases', t('teacherOverview.myReportedCases')) },
        { label: t('teacherOverview.reportAnIssue'), icon: <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>, action: () => navigateTo('reportMaintenanceIssue', t('teacherOverview.reportAnIssue')) },
      ],
    },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 bg-gray-50">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className={`p-5 rounded-2xl text-white shadow-lg ${theme.mainBg}`}>
        <h3 className="text-2xl font-bold">Welcome, {teacherProfile?.name || 'Teacher'}!</h3>
        <p className="text-sm opacity-90 mt-1">{t('teacherOverview.readyToInspireToday')}</p>
        {(isClassTeacher || isSubjectTeacher) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {isClassTeacher && myRoles.class_teacher_of.map((c: any) => (
              <span key={c.id} className="flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full">
                <UserGroupIcon className="w-3.5 h-3.5" /> Class Teacher — {c.name}
              </span>
            ))}
            {isSubjectTeacher && Array.from(new Set(myRoles.subject_assignments.map((s: any) => s.subject?.name).filter(Boolean))).map((name: any) => (
              <span key={name} className="flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full">
                <BookOpenIcon className="w-3.5 h-3.5" /> {name} Teacher
              </span>
            ))}
          </div>
        )}
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.05 }}>
          <StatCard label={t('teacherOverview.totalStudents')} value={statsLoading ? '...' : stats.totalStudents} icon={<BriefcaseIcon />} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.1 }}>
          <StatCard label={t('teacherOverview.totalAssignedClasses')} value={statsLoading ? '...' : stats.totalClasses} icon={<ViewGridIcon />} />
        </motion.div>
      </div>

      <div>
        <div className="flex overflow-x-auto pb-2 gap-3 no-scrollbar">
          {classesLoading ? (
            Array(2).fill(0).map((_, i) => (
              <div key={i} className="min-w-[160px] max-w-full bg-white p-4 rounded-2xl shadow-sm animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-100 rounded w-1/2"></div>
              </div>
            ))
          ) : teacherClasses.length > 0 ? (
            teacherClasses.map((c, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3, delay: Math.min(i, 10) * 0.04 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigateTo('classDetail', c.name || getFormattedClassName(c.grade, c.section, true, c.subject), {
                  classInfo: { ...c, schoolId, branchId: currentBranchId }
                })}
                className="min-w-[180px] max-w-full bg-white p-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow text-left border border-purple-100 hover:border-purple-300 group"
              >
                <div className="flex justify-between items-start mb-1">
                  <p className="font-bold text-gray-800 text-base">{c.name || getFormattedClassName(c.grade, c.section)}</p>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className={`w-2 h-2 rounded-full ${SUBJECT_COLORS[c.subject] || 'bg-purple-400'}`}></div>
                  <p className="text-xs font-semibold text-purple-600 truncate">{c.subject}</p>
                </div>
              </motion.button>
            ))
          ) : (
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-dashed border-gray-300 w-full text-center text-gray-500 text-sm">
              No classes assigned yet.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="flex justify-between items-end mb-2 px-1">
              <h3 className="text-lg font-bold text-gray-800">{t('teacherOverview.recentAssignments')}</h3>
              {ungradedAssignments.length > 1 && (
                <button onClick={() => navigateTo('assignmentsList', t('teacherOverview.manageAssignments'), {})} className="text-sm font-bold text-purple-600 hover:text-purple-800 px-2 py-1.5 -my-1 -mr-2 rounded-lg">
                  See more
                </button>
              )}
            </div>
            <div className="space-y-3">
              {loading ? (
                <div className="w-full bg-white p-3 rounded-xl shadow-sm animate-pulse flex justify-between items-center">
                  <div className="space-y-2 w-1/2">
                    <div className="h-4 bg-gray-200 rounded w-full"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                  <div className="h-4 bg-gray-200 rounded w-12"></div>
                </div>
              ) : ungradedAssignments.length > 0 ? ungradedAssignments.slice(0, 1).map(a => (
                <motion.button
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigateTo('assignmentSubmissions', `Submissions: ${a.title}`, {
                    assignment: { ...a, classId: a.classId || a.class_id, className: a.className || a.class_name, dueDate: a.dueDate || a.due_date }, schoolId, teacherId, branchId: currentBranchId
                  })}
                  className="w-full text-left bg-white p-3 rounded-xl shadow-sm hover:shadow-md transition-shadow flex justify-between items-center"
                >
                  <div>
                    <p className="font-bold text-gray-800">{a.title}</p>
                    <p className="text-sm text-gray-500">{a.class_name}</p>
                  </div>
                  <div className="flex items-center space-x-2 text-purple-600 font-semibold">
                    <span>{t('teacherOverview.view')}</span>
                    <ChevronRightIcon className="w-5 h-5" />
                  </div>
                </motion.button>
              )) : <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white p-4 rounded-xl shadow-sm text-center text-gray-500">{t('teacherOverview.noPendingTasksGreatJob')}</motion.div>}
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-lg font-bold text-gray-800 px-1">{t('teacherOverview.quickActions')}</h3>
            {quickActionGroups.filter(group => group.items.length > 0).map((group) => (
              <div key={group.title}>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{group.title}</h4>
                {/* Sized by the room the grid actually has. These breakpoints measured
                    62px cells at 1024px, because `md:grid-cols-6` reads the viewport
                    while the grid lives in a column the sidebar has narrowed. */}
                <div className="grid gap-2 sm:gap-3 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]">
                  {group.items.map((action, i) => (
                    <motion.button
                      key={action.label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.02 }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={action.action}
                      className={`${theme.cardBg} p-2 sm:p-3 rounded-xl shadow-sm flex flex-col items-center justify-center space-y-1 sm:space-y-2 hover:bg-purple-200 transition-colors`}
                    >
                      <div className={`${theme.iconColor} flex-shrink-0`}>{React.cloneElement(action.icon as React.ReactElement<{ className?: string }>, { className: "h-6 w-6 sm:h-7 sm:w-7" })}</div>
                      <span className={`font-semibold ${theme.textColor} text-center text-xs leading-tight`}>{action.label}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-6 lg:self-start">
          <div>
            <h3 className="text-lg font-bold text-gray-800 mb-2 px-1">{t('teacherOverview.todaySSchedule')}</h3>
            {loading ? (
              <div className="space-y-3">
                {Array(3).fill(0).map((_, i) => (
                  <div key={i} className="flex items-center space-x-3 p-3 bg-white rounded-xl shadow-sm animate-pulse">
                    <div className="w-16 h-4 bg-gray-200 rounded"></div>
                    <div className="w-1 h-10 rounded-full bg-gray-200"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : scheduleStatus.type === 'weekend' ? (
              <div className="bg-white p-4 rounded-xl shadow-sm text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="font-bold text-gray-700">{t('teacherOverview.itSTheWeekend')}</p>
                <p className="text-xs text-gray-500 mt-1">{t('teacherOverview.noClassesTodayEnjoyYourRest')}</p>
              </div>
            ) : todaySchedule.length === 0 ? (
              <div className="bg-white p-4 rounded-xl shadow-sm text-center text-gray-500">
                {t('teacherOverview.noClassesScheduledForToday')}
              </div>
            ) : (
              <div className="space-y-3">

                {/* ── Real-time status banner ── */}
                <AnimatePresence mode="wait">
                {scheduleStatus.type === 'before_school' && (
                  <motion.div key="before" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-0.5">{t('teacherOverview.beforeSchool')}</p>
                    <p className="text-sm font-semibold text-blue-800">
                      First class at {formatTime12Hour((scheduleStatus as any).next.start_time)}
                    </p>
                    <p className="text-xs text-blue-600">{(scheduleStatus as any).next.subject} — {(scheduleStatus as any).next.class_name}</p>
                  </motion.div>
                )}
                {scheduleStatus.type === 'in_class' && (
                  <motion.div key="inclass" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="bg-green-50 border-2 border-green-300 rounded-xl p-3 flex items-start gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0 mt-1" />
                    <div>
                      <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-0.5">{t('teacherOverview.inClassNow')}</p>
                      <p className="text-sm font-bold text-green-900">{(scheduleStatus as any).current.subject}</p>
                      <p className="text-xs text-green-700">{(scheduleStatus as any).current.class_name}</p>
                      {(scheduleStatus as any).current.end_time && (
                        <p className="text-xs text-green-600 mt-0.5">Ends at {formatTime12Hour((scheduleStatus as any).current.end_time)}</p>
                      )}
                    </div>
                  </motion.div>
                )}
                {scheduleStatus.type === 'break' && (
                  <motion.div key="break" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-0.5">{t('teacherOverview.onBreak')}</p>
                    <p className="text-sm font-semibold text-amber-800">
                      Next: {(scheduleStatus as any).next.subject} at {formatTime12Hour((scheduleStatus as any).next.start_time)}
                    </p>
                    <p className="text-xs text-amber-600">{(scheduleStatus as any).next.class_name}</p>
                  </motion.div>
                )}
                {scheduleStatus.type === 'after_school' && (
                  <motion.div key="afterschool" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                    <p className="text-lg mb-0.5">🏠</p>
                    <p className="font-bold text-slate-700 text-sm">{t('teacherOverview.closingTime')}</p>
                    <p className="text-xs text-slate-500">{t('teacherOverview.allClassesDoneForTodaySeeYouTomorrow')}</p>
                  </motion.div>
                )}
                </AnimatePresence>

                {/* ── Period list — highlights the current lesson ── */}
                {todaySchedule.slice(0, 4).map((entry, i) => {
                  const nowMins = now.getHours() * 60 + now.getMinutes();
                  const start   = timeToMins(entry.start_time);
                  const end     = timeToMins(entry.end_time || '') || start + 45;
                  const isCurrent = nowMins >= start && nowMins < end;
                  const isPast    = nowMins >= end;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: isPast ? 0.5 : 1, x: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(i, 6) * 0.05 }}
                      className={`flex items-center space-x-3 p-3 rounded-xl shadow-sm ${
                      isCurrent ? 'bg-green-50 border-2 border-green-300' : 'bg-white'
                    }`}>
                      <div className="w-16 text-center flex-shrink-0">
                        <p className={`font-bold text-sm ${isCurrent ? 'text-green-700' : 'text-gray-800'}`}>
                          {formatTime12Hour(entry.start_time)}
                        </p>
                        {isCurrent && (
                          <span className="text-xs font-black text-green-600 uppercase tracking-wide">NOW</span>
                        )}
                      </div>
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        isCurrent ? 'bg-green-500 animate-pulse' : SUBJECT_COLORS[entry.subject] || 'bg-gray-400'
                      }`} />
                      <div className="min-w-0">
                        <p className={`font-semibold truncate ${isCurrent ? 'text-green-900' : 'text-gray-800'}`}>{entry.subject}</p>
                        {/* Printed a bare "(0)" when a lesson had no class name. An empty
                            value is not worth a line of its own. */}
                        {entry.class_name ? <p className="text-xs text-gray-500">({entry.class_name})</p> : null}
                      </div>
                    </motion.div>
                  );
                })}

                {todaySchedule.length > 4 && (
                  <button
                    onClick={() => navigateTo('timetable', t('teacherOverview.timetableDashboard'), {})}
                    className="text-sm font-semibold text-purple-600 w-full text-center mt-1 flex items-center justify-center gap-1 group"
                  >
                    See {todaySchedule.length - 4} more classes
                    <ChevronRightIcon className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}
                <button onClick={() => navigateTo('timetable', t('teacherOverview.timetableDashboard'), {})} className="text-sm font-semibold text-purple-600 w-full text-center mt-1 py-2.5 rounded-lg hover:bg-purple-50 transition-colors">
                  View Full Timetable
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AIInsightsPanel />
    </div>
  );
};

export default TeacherOverview;