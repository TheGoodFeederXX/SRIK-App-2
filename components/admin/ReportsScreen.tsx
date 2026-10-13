

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChartBarIcon, TrophyIcon, TrendingUpIcon, SUBJECT_COLORS, gradeColors } from '../../constants';
// import { mockSubjectAverages, mockTopStudents, mockAttendanceCorrelation } from '../../data';
import { getCurrentTerm, listSubjectMarks } from '../../src/lib/supabase/assessments';
import { useAutoSync } from '../../hooks/useAutoSync';
import { User as UserIcon } from 'lucide-react';

interface SubjectAverage {
  subject: string;
  averageScore: number;
}

interface TopStudent {
  id: string;
  name: string;
  // NO `grade` OR `section`. Both came from the undeployed server, and the school does not
  // store a child's year as a number or their section as a letter — the class is a row in
  // `classes` with a name like "4 Al-Busiri (4B)". A report that prints an invented form
  // label beside a real score is worse than one that prints only the score.
  averageScore: number;
}

const SubjectGradesChart: React.FC<{ data: SubjectAverage[] }> = ({ data }) => {
  const maxValue = 100;
  return (
    <div className="space-y-2">
      {data.map((item, idx) => {
        const colorClass = SUBJECT_COLORS[item.subject] || 'bg-gray-200 text-gray-800';
        return (
          <div key={item.subject} className="flex items-center space-x-2">
            <div className="w-28 text-sm font-medium text-gray-600 truncate">{item.subject}</div>
            <div className="flex-grow bg-gray-200 rounded-full h-5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(item.averageScore / maxValue) * 100}%` }}
                transition={{ duration: 0.5, delay: idx * 0.05, ease: 'easeOut' }}
                className={`${colorClass} h-5 rounded-full flex items-center justify-end pr-2 text-xs font-bold`}
              >
                {item.averageScore}
              </motion.div>
            </div>
          </div>
        )
      })}
    </div>
  );
};

const TopStudentsList: React.FC<{ students: TopStudent[] }> = ({ students }) => {
    const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {students.map((student, si) => (
        <motion.div key={student.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: si * 0.05 }} className="bg-gray-50 p-3 rounded-lg flex items-center space-x-3">
          {/* Initials, from the one name the record holds. The old version showed an
              avatar from a field that does not exist and a "Grade 10A" label read from the
              undeployed server — a form and section this school never had. */}
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-500">
            <span className="text-sm font-bold">{student.name?.charAt(0) || '?'}</span>
          </div>
          <div className="flex-grow">
            <p className="font-bold text-gray-800">{student.name}</p>
            <p className="text-sm text-gray-500">{t('reportsScreen.purataMarkah')}</p>
          </div>
          <div className="text-right">
            <p className="font-bold text-lg text-green-600">{student.averageScore}%</p>
            <p className="text-xs text-gray-500">{t('reportsScreen.average')}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

interface ReportsScreenProps {
  schoolId?: string;
  currentBranchId?: string;
}

const ReportsScreen: React.FC<ReportsScreenProps> = ({ schoolId, currentBranchId }) => {
    const { t } = useTranslation();
  const [subjectAverages, setSubjectAverages] = useState<SubjectAverage[]>([]);
  const [topStudents, setTopStudents] = useState<TopStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Unified Backend-driven Auto Sync
  useAutoSync(['academic_performance'], () => {
    console.log('🔄 [ReportsScreen] Auto-sync triggered');
    fetchReportsData();
  });

  const fetchReportsData = async () => {
    setLoading(true);
    setError(null);
    try {
      // FROM THE REAL MARKS. The old code read a school-wide performance payload from an
      // undeployed server and rebuilt both reports in the browser; with the server gone it
      // showed an empty report. Every figure below now comes from published marks.
      const term = await getCurrentTerm();
      if (!term) {
        setSubjectAverages([]);
        setTopStudents([]);
        return;
      }

      const rows = await listSubjectMarks(term.id);

      // 1. Subject averages, over children who actually have a mark.
      const subjectMap = new Map<string, { total: number; count: number }>();
      for (const r of rows) {
        if (r.averagePercent === null) continue;
        const key = r.subjectName ?? 'Tanpa Subjek';
        const cur = subjectMap.get(key) ?? { total: 0, count: 0 };
        cur.total += r.averagePercent;
        cur.count += 1;
        subjectMap.set(key, cur);
      }
      setSubjectAverages(
        [...subjectMap.entries()]
          .map(([subject, v]) => ({ subject, averageScore: Math.round(v.total / v.count) }))
          .sort((a, b) => b.averageScore - a.averageScore),
      );

      // 2. Top children, by their average across the subjects they were marked in.
      const studentMap = new Map<string, { name: string; total: number; count: number }>();
      for (const r of rows) {
        if (r.averagePercent === null) continue;
        const cur = studentMap.get(r.studentId) ?? { name: r.studentName, total: 0, count: 0 };
        cur.total += r.averagePercent;
        cur.count += 1;
        studentMap.set(r.studentId, cur);
      }
      setTopStudents(
        [...studentMap.entries()]
          .map(([id, v]) => ({ id, name: v.name, averageScore: Math.round(v.total / v.count) }))
          .sort((a, b) => b.averageScore - a.averageScore)
          .slice(0, 5),
      );

      // 3. THE ATTENDANCE CORRELATION IS GONE, AND DELIBERATELY. It plotted average score
      // against an attendance bracket — but attendance was never fetched here at all. The
      // brackets were assigned by SCORE, not attendance, so the chart drew a relationship
      // between two things where one of them was the other, relabelled. It is not restored
      // because a per-child attendance figure and mark average for the same term would have
      // to be joined carefully; a chart that invents the axis it claims to measure is worse
      // than no chart.
    } catch (err: any) {
      console.error("Error fetching reports:", err);
      setError(err.message || 'Failed to generate school reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) fetchReportsData();
  }, [schoolId, currentBranchId]);

  return (
    <div className="p-4 space-y-5 bg-gray-50">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 mb-4 rounded-xl shadow-sm text-sm font-semibold">
          {error}
        </div>
      )}
      {loading && <div className="p-8 text-center text-blue-500 font-semibold animate-pulse">{t('reportsScreen.generatingReports')}</div>}

      {!loading && !error && (
        <>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-blue-100 text-blue-500 p-2 rounded-lg"><ChartBarIcon /></div>
              <h3 className="font-bold text-gray-800">{t('reportsScreen.averageGradesBySubject')}</h3>
            </div>
            {subjectAverages.length > 0 ? <SubjectGradesChart data={subjectAverages} /> : <p className="text-gray-400 text-sm">{t('reportsScreen.noAcademicDataAvailable')}</p>}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }} className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-green-100 text-green-500 p-2 rounded-lg"><TrophyIcon /></div>
              <h3 className="font-bold text-gray-800">{t('reportsScreen.topPerformingStudents')}</h3>
            </div>
            {topStudents.length > 0 ? <TopStudentsList students={topStudents} /> : <p className="text-gray-400 text-sm">{t('reportsScreen.noStudentDataAvailable')}</p>}
          </motion.div>

        </>
      )}
    </div>
  );
};

export default ReportsScreen;
