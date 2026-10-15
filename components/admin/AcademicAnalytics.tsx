import { useTranslation } from 'react-i18next';
﻿import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listClasses } from '../../src/lib/supabase/academics';
import { getAcademicAnalytics, getCurrentTerm } from '../../src/lib/supabase/assessments';
import { toast } from 'react-hot-toast';
import { useAutoSync } from '../../hooks/useAutoSync';
import { TrendingUp, Target, TrendingDown, Award, Users, AlertTriangle, Star } from 'lucide-react';
import CenteredLoader from '../ui/CenteredLoader';

const CANONICAL_TERMS = ['Penggal 1', 'Penggal 2', 'Penggal 3'];

// These mirror what the database returns. The screen previously carried a `percentage`
// for each grade, a `passRate` per subject and a `GPA` per class — none of which any
// query produced. They were rendered from undefined values.
interface GradeDistribution {
    grade: string;
    count: number;
}

interface SubjectPerformance {
    subjectId: string;
    subject: string | null;
    average: number;
    count: number;
}

interface ClassComparison {
    classId: string;
    className: string | null;
    average: number;
    count: number;
}

interface AcademicAnalyticsProps {
    schoolId: string;
    currentBranchId?: string | null;
}

const AcademicAnalytics: React.FC<AcademicAnalyticsProps> = ({ schoolId, currentBranchId }) => {
    const { t } = useTranslation();
    const [gradeDistribution, setGradeDistribution] = useState<GradeDistribution[]>([]);
    const [subjectPerformance, setSubjectPerformance] = useState<SubjectPerformance[]>([]);
    const [classComparison, setClassComparison] = useState<ClassComparison[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
    const [selectedClass, setSelectedClass] = useState<string | null>(null);
    const [classOptions, setClassOptions] = useState<{ id: string; name: string }[]>([]);

    // Key metrics. There is no GPA: this school marks out of 100 and grades A-E, so a
    // 4-point GPA is a number the school does not use and never produced. The honest
    // headline is the average mark and the pass rate.
    //
    // passRate is NULL, not 0, until marks exist — a screen showing 0% for a term with
    // nothing marked tells the school something untrue.
    const [metrics, setMetrics] = useState<{
        passRate: number | null;
        marksCounted: number;
        topPerformer: string | null;
        topPerformerAverage: number | null;
        overallAverage: number | null;
    }>({
        passRate: null,
        marksCounted: 0,
        topPerformer: null,
        topPerformerAverage: null,
        overallAverage: null,
    });

    useEffect(() => {
        if (schoolId) {
            fetchAnalytics();
        }
    }, [selectedTerm, selectedClass, schoolId, currentBranchId]);

    useEffect(() => {
        if (!schoolId) return;
        listClasses()
            .then(data => setClassOptions(data.map(c => ({ id: c.id, name: c.displayName || c.name }))))
            .catch(() => setClassOptions([]));
    }, [schoolId, currentBranchId]);

    useAutoSync(['assessment_results', 'assessments', 'student_enrollments', 'students', 'classes'], () => {
        console.log('🔄 [AcademicAnalytics] Real-time auto-sync triggered');
        fetchAnalytics();
    });

    const fetchAnalytics = async () => {
        try {
            setLoading(true);
            // The term is resolved from the school's own calendar when the screen has
            // not chosen one, rather than sending an empty term the database would refuse.
            let termId = selectedTerm;
            if (!termId) {
                const current = await getCurrentTerm();
                termId = current?.id ?? null;
                if (termId) setSelectedTerm(termId);
            }
            if (!termId) {
                // No term configured at all. An empty screen is honest here; 0% is not.
                setGradeDistribution([]);
                setSubjectPerformance([]);
                setClassComparison([]);
                setMetrics({ passRate: null, marksCounted: 0, topPerformer: null, topPerformerAverage: null, overallAverage: null });
                return;
            }

            const data = await getAcademicAnalytics(termId, selectedClass || null);

            setGradeDistribution(data.gradeDistribution ?? []);
            setSubjectPerformance(data.subjectPerformance ?? []);
            setClassComparison(data.classComparison ?? []);
            setMetrics(data.metrics);
        } catch (error: any) {
            console.error('Error fetching analytics:', error);
            toast.error(t('academicAnalytics.failedToLoadAnalytics'));
        } finally {
            setLoading(false);
        }
    };

    const getGradeColor = (grade: string) => {
        const colors: { [key: string]: string } = {
            'A': 'bg-green-500',
            'B': 'bg-blue-500',
            'C': 'bg-yellow-500',
            'D': 'bg-orange-500',
            'E': 'bg-red-400',
            'F': 'bg-red-600'
        };
        return colors[grade] || 'bg-gray-500';
    };

    const getPerformanceIcon = (rate: number) => {
        if (rate >= 80) return <TrendingUp className="h-5 w-5 text-green-600" />;
        if (rate >= 60) return <Target className="h-5 w-5 text-yellow-600" />;
        return <TrendingDown className="h-5 w-5 text-red-600" />;
    };

    // Honestly-derivable "predictive" stats — computed from the same real
    // classComparison/metrics data already on screen, not fabricated numbers.
    // A class is "at risk" when its average mark is below the school's own pass band
    // (50% is the floor of a C on this scale). "Strongest" is simply the highest average
    // — no GPA, because the school does not use one.
    // The denominator for each grade's share. Summed from the counts the database
    // returned, so the bars always add up to what was actually marked.
    const gradeTotal = gradeDistribution.reduce((sum, g) => sum + g.count, 0);

    const atRiskClasses = classComparison.filter(c => (c.average ?? 0) < 50);
    const topClasses = classComparison.slice().sort((a, b) => b.average - a.average).slice(0, 3);

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto pb-24 lg:pb-6">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-4 sm:p-6 text-white mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t('academicAnalytics.academicAnalytics')}</h1>
                <p className="text-indigo-100 text-sm sm:text-base">{t('academicAnalytics.comprehensivePerformanceTrackingAndAnalysis')}</p>
            </motion.div>

            {/* Filters */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }} className="bg-white rounded-xl shadow-sm p-4 mb-6">
                <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Term</label>
                        <div className="flex flex-wrap gap-2">
                            {(['current', ...CANONICAL_TERMS] as const).map(term => (
                                <motion.button
                                    key={term}
                                    whileHover={{ scale: 1.03 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => setSelectedTerm(term)}
                                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold ${selectedTerm === term ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                >
                                    {term === 'current' ? 'All Terms' : term}
                                </motion.button>
                            ))}
                        </div>
                    </div>
                    <div className="sm:ml-auto">
                        <label className="block text-xs font-semibold text-gray-700 mb-2">{t('common.class')}</label>
                        <select
                            value={selectedClass || 'all'}
                            onChange={(e) => setSelectedClass(e.target.value === 'all' ? null : e.target.value)}
                            className="w-full sm:w-56 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="all">{t('academicAnalytics.allClasses')}</option>
                            {classOptions.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </motion.div>

            {loading ? (
                <CenteredLoader className="h-64" />
            ) : (
            <AnimatePresence mode="wait">
            <motion.div key={`${selectedTerm}-${selectedClass}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0 }} className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs sm:text-sm text-gray-600">{t('academicAnalytics.purataMarkah')}</p>
                            <p className="text-2xl sm:text-3xl font-bold text-indigo-600">
                                {metrics.overallAverage === null ? '—' : metrics.overallAverage}
                            </p>
                            {/* A dash, not 0: a term with nothing marked has no average,
                                and showing 0 would read as a school-wide failure. */}
                            <p className="text-xs sm:text-xs text-gray-500 mt-1">
                                {metrics.marksCounted > 0
                                    ? `daripada ${metrics.marksCounted} markah`
                                    : 'tiada markah lagi'}
                            </p>
                        </div>
                        <div className="p-2 sm:p-3 bg-indigo-100 rounded-lg">
                            <Award className="h-5 w-5 sm:h-6 sm:w-6 text-indigo-600" />
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }} className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs sm:text-sm text-gray-600">{t('academicAnalytics.kadarLulus')}</p>
                            <p className="text-2xl sm:text-3xl font-bold text-green-600">
                                {metrics.passRate === null ? '—' : `${metrics.passRate}%`}
                            </p>
                            {/* No "vs last term" comparison: no previous-term figures are
                                stored, and inventing a trend line would be a claim about
                                the school that nothing supports. */}
                            <p className="text-xs sm:text-xs text-gray-500 mt-1">
                                {metrics.marksCounted > 0 ? 'markah diterbitkan' : 'belum ada markah'}
                            </p>
                        </div>
                        <div className="p-2 sm:p-3 bg-green-100 rounded-lg">
                            <Target className="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }} className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs sm:text-sm text-gray-600">{t('academicAnalytics.topPerformer')}</p>
                            <p className="text-base sm:text-lg font-bold text-gray-900 truncate max-w-[120px] sm:max-w-none">{metrics.topPerformer ?? '—'}</p>
                            <p className="text-xs sm:text-xs text-gray-500 mt-1">Purata: {metrics.topPerformerAverage ?? '—'}</p>
                        </div>
                        <div className="p-2 sm:p-3 bg-yellow-100 rounded-lg">
                            <Award className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-600" />
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.15 }} className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs sm:text-sm text-gray-600">{t('academicAnalytics.bilanganMarkah')}</p>
                            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{metrics.marksCounted}</p>
                            <p className="text-xs sm:text-xs text-gray-500 mt-1">{t('academicAnalytics.acrossClasses', { count: classComparison.length })}</p>
                        </div>
                        <div className="p-2 sm:p-3 bg-blue-100 rounded-lg">
                            <Users className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* Grade Distribution */}
            <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{t('academicAnalytics.gradeDistribution')}</h3>
                <div className="space-y-3">
                    {gradeDistribution.map((item, gi) => (
                        <div key={item.grade}>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="font-semibold text-gray-900">Grade {item.grade}</span>
                                <span className="text-gray-600">
                                    {item.count} markah ({gradeTotal > 0 ? ((item.count / gradeTotal) * 100).toFixed(1) : '0.0'}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-4">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${gradeTotal > 0 ? (item.count / gradeTotal) * 100 : 0}%` }}
                                    transition={{ duration: 0.5, delay: gi * 0.05, ease: 'easeOut' }}
                                    className={`${getGradeColor(item.grade)} h-4 rounded-full flex items-center justify-end pr-2`}
                                >
                                    {gradeTotal > 0 && (item.count / gradeTotal) * 100 > 10 && (
                                        <span className="text-white text-xs font-semibold">
                                            {((item.count / gradeTotal) * 100).toFixed(0)}%
                                        </span>
                                    )}
                                </motion.div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Subject Performance & Class Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Subject Performance */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">{t('academicAnalytics.subjectPerformance')}</h3>
                    <div className="space-y-3">
                        {subjectPerformance.length === 0 && (
                            <p className="text-center text-gray-400 py-8 text-sm">{t('academicAnalytics.belumAdaMarkahUntukPenggalAtauKelasIni')}</p>
                        )}
                        {subjectPerformance.slice(0, 6).map((subject, si) => (
                            <motion.div
                                key={subject.subjectId}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.2, delay: si * 0.05 }}
                                whileHover={{ scale: 1.01 }}
                                className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-colors"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div>
                                        <h4 className="font-semibold text-gray-900">{subject.subject ?? '—'}</h4>
                                        <p className="text-xs text-gray-500">{t('academicAnalytics.marksCount', { count: subject.count })}</p>
                                    </div>
                                    {/* Judged against the school's own pass line (50% is
                                        the floor of a C), not an invented threshold. */}
                                    {getPerformanceIcon(subject.average >= 50 ? 100 : 0)}
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-gray-600">{t('academicAnalytics.purataMarkah')}</p>
                                        <p className="text-lg font-bold text-indigo-600">{subject.average}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-600">{t('academicAnalytics.marks')}</p>
                                        <p className="text-lg font-bold text-gray-700">{subject.count}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Class Comparison */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">{t('academicAnalytics.classComparison')}</h3>
                    <div className="space-y-3">
                        {classComparison.length === 0 && (
                            <p className="text-center text-gray-400 py-8 text-sm">{t('academicAnalytics.belumAdaMarkahUntukPenggalAtauKelasIni')}</p>
                        )}
                        {classComparison.map((classData, index) => (
                            <motion.div
                                key={classData.classId}
                                initial={{ opacity: 0, x: 8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.2, delay: index * 0.05 }}
                                whileHover={{ scale: 1.01 }}
                                className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-colors"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center space-x-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : 'bg-indigo-500'
                                            }`}>
                                            {index + 1}
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-900">{classData.className ?? '—'}</h4>
                                            <p className="text-xs text-gray-500">{t('academicAnalytics.marksCount', { count: classData.count })}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                                    <div className="bg-gray-50 rounded p-2">
                                        <p className="text-xs text-gray-600">{t('academicAnalytics.purataMarkah')}</p>
                                        <p className="text-lg font-bold text-indigo-600">{classData.average}</p>
                                    </div>
                                    <div className="bg-gray-50 rounded p-2">
                                        <p className="text-xs text-gray-600">{t('academicAnalytics.marks')}</p>
                                        <p className="text-lg font-bold text-gray-700">{classData.count}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* WHAT THIS PANEL USED TO SAY. It showed a "Projected GPA (at current
                trend)" and an arrow comparing this term to the previous one. Neither
                could be produced: no GPA exists on this scale, and no previous-term
                figures are stored to compare against. It was a forecast with no inputs.
                A school reading "↑ 3% vs. previous term" would reasonably believe
                something had been measured. Nothing had.
                What follows is only what the stored marks actually show. */}
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4 sm:p-6 mt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3">{t('academicAnalytics.gambaranKeseluruhan')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="bg-white rounded-lg p-4">
                        <p className="text-sm text-gray-600 mb-1">{t('academicAnalytics.purataKeseluruhan')}</p>
                        <p className="text-2xl font-bold text-indigo-600">
                            {metrics.overallAverage === null ? '—' : metrics.overallAverage}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            {metrics.marksCounted > 0
                                ? `dikira daripada ${metrics.marksCounted} markah`
                                : 'belum ada markah diterbitkan'}
                        </p>
                    </motion.div>
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.06 }} className="bg-white rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                            <p className="text-sm text-gray-600">{t('academicAnalytics.kelasPerluPerhatian')}</p>
                        </div>
                        <p className="text-2xl font-bold text-orange-600">{atRiskClasses.length}</p>
                        {/* 50% is the floor of a C on THIS school's scale — the line
                            between a pass and a D, not a number I chose. */}
                        <p className="text-xs text-gray-500 mt-1">{t('academicAnalytics.purataBawah50DAtauE')}</p>
                    </motion.div>
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.12 }} className="bg-white rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Star className="h-4 w-4 text-green-500" />
                            <p className="text-sm text-gray-600">{t('academicAnalytics.kelasTerbaik')}</p>
                        </div>
                        <p className="text-2xl font-bold text-green-600">
                            {topClasses[0]?.className ?? '—'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            {topClasses[0] ? `purata ${topClasses[0].average}` : 'belum ada data'}
                        </p>
                    </motion.div>
                </div>
            </div>
            </motion.div>
            </AnimatePresence>
            )}
        </div>
    );
};

export default AcademicAnalytics;
