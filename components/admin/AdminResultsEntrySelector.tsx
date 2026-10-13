import { useTranslation } from 'react-i18next';
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { StudentsIcon, ChevronRightIcon, gradeColors, getFormattedClassName } from '../../constants';
import { ClassInfo } from '../../types';
import { useQuery } from '@tanstack/react-query';
import { listClasses } from '../../src/lib/supabase/academics';
import { useAutoSync } from '../../hooks/useAutoSync';
import CenteredLoader from '../ui/CenteredLoader';

interface AdminResultsEntrySelectorProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    schoolId?: string;
    currentBranchId?: string;
}

const AdminResultsEntrySelector: React.FC<AdminResultsEntrySelectorProps> = ({ navigateTo, schoolId, currentBranchId }) => {
    const { t } = useTranslation();
    const { data: rawClasses = [], isLoading } = useQuery({
        queryKey: ['classes', schoolId, currentBranchId],
        // `api.getClasses(schoolId, branchId)` — an Express endpoint with no server.
            // SRIK is one school, so the branch argument is gone rather than left as
            // a parameter nobody can supply.
            queryFn: () => listClasses(),
        enabled: !!schoolId
    });

    useAutoSync(['classes'], () => {
        console.log('🔄 [ResultsEntrySelector] Auto-sync triggered');
    });

    const classes: ClassInfo[] = useMemo(() => (
        // No school or branch filter any more. There is one school and its classes
        // are the rows the database returns — a filter on a `school_id` the schema
        // does not have was always `undefined === schoolId`, which is why the list
        // came out empty rather than filtered.
        rawClasses.map(c => ({
            id: c.id,
            // The class's own name. There is no subject column: a class is not a
            // subject, and the subjects taught to it come from its assignments.
            name: c.displayName,
            subject: '',
            grade: c.yearLevel,
            section: '',
            department: '',
            studentCount: c.studentCount,
        } as unknown as ClassInfo & { name?: string; subjects?: any[] }))
    ), [rawClasses]);

    const groupedClasses = useMemo(() => {
        const groups: { [key: number]: Map<string, ClassInfo> } = {};
        classes.forEach(cls => {
            if (!groups[cls.grade]) {
                groups[cls.grade] = new Map();
            }
            const name = getFormattedClassName(cls.grade, cls.section);
            const existing = groups[cls.grade].get(name);
            if (existing) {
                existing.studentCount += (cls.studentCount || 0);
            } else {
                groups[cls.grade].set(name, { ...cls });
            }
        });

        // Convert Map to Array
        const finalGroups: { [key: number]: ClassInfo[] } = {};
        Object.entries(groups).forEach(([grade, map]) => {
            finalGroups[Number(grade)] = Array.from(map.values());
        });
        return finalGroups;
    }, [classes]);

    if (isLoading && classes.length === 0) {
        return <CenteredLoader message={t('adminResultsEntrySelector.loadingClasses')} className="h-full" />;
    }

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto">
                <div className="bg-cyan-50 p-4 rounded-xl text-center border border-cyan-200">
                    <h3 className="font-bold text-lg text-cyan-800">{t('adminResultsEntrySelector.resultsEntrySelection')}</h3>
                    <p className="text-sm text-cyan-700">{t('adminResultsEntrySelector.chooseAClassToEnterStudentAcademicResults')}</p>
                </div>

                {Object.keys(groupedClasses).length === 0 && (
                    <div className="text-center py-10">
                        <p className="text-gray-500">{t('adminResultsEntrySelector.noClassesFound')}</p>
                    </div>
                )}

                {Object.keys(groupedClasses).sort((a, b) => Number(a) - Number(b)).map((gradeStr, gi) => {
                    const grade = Number(gradeStr);
                    const gradeClasses = groupedClasses[grade];
                    const gradeColorClass = gradeColors[grade] || 'bg-gray-200 text-gray-800';
                    const [bgColor, textColor] = gradeColorClass.split(' ');

                    return (
                        <motion.div key={grade} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(gi, 10) * 0.05 }} className={`bg-white rounded-2xl shadow-sm overflow-hidden mb-4`}>
                            <div className={`${bgColor} p-4`}>
                                <h3 className={`font-bold text-lg ${textColor}`}>{getFormattedClassName(grade, "")}</h3>
                            </div>
                            <div className="p-4 space-y-3">
                                {gradeClasses.map(cls => (
                                    <motion.button
                                        key={getFormattedClassName(grade, cls.section)}
                                        whileHover={{ scale: 1.01 }}
                                        whileTap={{ scale: 0.99 }}
                                        onClick={() => navigateTo('classGradebook', `Gradebook: ${getFormattedClassName(grade, cls.section, true, cls.subject)}`, { classInfo: cls })}
                                        className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-100"
                                    >
                                        <div className="flex items-center space-x-3">
                                            <div className="bg-white p-2 rounded-lg border border-gray-200">
                                                <StudentsIcon className={`h-5 w-5 ${textColor}`} />
                                            </div>
                                            <div className="text-left">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-gray-800">{getFormattedClassName(grade, cls.section)}</p>
                                                    {cls.subject && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{cls.subject}</span>}
                                                </div>
                                                <p className="text-sm text-gray-500">
                                                    {cls.studentCount} Students recorded
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-gray-400">
                                            <ChevronRightIcon />
                                        </div>
                                    </motion.button>
                                ))}
                            </div>
                        </motion.div>
                    );
                })}
            </main>
        </div>
    );
};

export default AdminResultsEntrySelector;
