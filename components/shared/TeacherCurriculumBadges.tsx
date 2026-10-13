import { useTranslation } from 'react-i18next';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, BookOpen } from 'lucide-react';

interface TeacherCurriculumBadgesProps {
    curriculumEligibility: string[] | string | null;
    size?: 'sm' | 'md' | 'lg';
    showWarning?: boolean;
}

export default function TeacherCurriculumBadges({
    curriculumEligibility,
    size = 'md',
    showWarning = false
}: TeacherCurriculumBadgesProps) {
    const { t } = useTranslation();

    const sizeClasses = {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-sm px-3 py-1',
        lg: 'text-base px-4 py-1.5',
    };

    if (!curriculumEligibility) {
        return (
            <div className="flex items-center gap-2">
                <Badge variant="outline" className={`${sizeClasses[size]} border-red-300 text-red-700`}>
                    <AlertCircle className="h-3 w-3 mr-1" />
                     {t('teacherCurriculumBadges.noCurriculumSet')}
                </Badge>
                {showWarning && (
                    <span className="text-xs text-red-600">{t('teacherCurriculumBadges.cannotBeAssignedToClass')}</span>
                )}
            </div>
        );
    }

    const isKssr = Array.isArray(curriculumEligibility)
        ? curriculumEligibility.includes('KSSR')
        : (curriculumEligibility === 'KSSR' || curriculumEligibility === 'Both');

    const isBritish = Array.isArray(curriculumEligibility)
        ? curriculumEligibility.includes('British')
        : (curriculumEligibility === 'British' || curriculumEligibility === 'Both');

    const isBoth = (isKssr && isBritish) || curriculumEligibility === 'Both';

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {isKssr && (
                <Badge className={`${sizeClasses[size]} bg-green-600 hover:bg-green-700 text-white`}>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    KSSR
                </Badge>
            )}

            {isBritish && (
                <Badge className={`${sizeClasses[size]} bg-blue-600 hover:bg-blue-700 text-white`}>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    British
                </Badge>
            )}

            {isBoth && (
                <Badge className={`${sizeClasses[size]} bg-purple-600 hover:bg-purple-700 text-white`}>
                    <BookOpen className="h-3 w-3 mr-1" />
                     {t('teacherCurriculumBadges.both')}
                </Badge>
            )}
        </div>
    );
}

// Validation helper to check if teacher can be assigned to a curriculum
export function canTeacherTeachCurriculum(
    teacherEligibility: string[] | string | null,
    requiredCurriculum: 'KSSR' | 'British'
): boolean {
    if (!teacherEligibility) return false;
    if (Array.isArray(teacherEligibility)) {
        return teacherEligibility.includes(requiredCurriculum);
    }
    if (teacherEligibility === 'Both') return true;
    return teacherEligibility === requiredCurriculum;
}

// Warning component to show when trying to assign incompatible teacher
interface CurriculumMismatchWarningProps {
    teacherName: string;
    teacherEligibility: string[] | string | null;
    requiredCurriculum: 'KSSR' | 'British';
}

export function CurriculumMismatchWarning({
    teacherName,
    teacherEligibility,
    requiredCurriculum
}: CurriculumMismatchWarningProps) {
    const { t } = useTranslation();
    if (canTeacherTeachCurriculum(teacherEligibility, requiredCurriculum)) {
        return null;
    }

    return (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
                <p className="text-sm font-semibold text-red-900">{t('teacherCurriculumBadges.curriculumMismatch')}</p>
                <p className="text-xs text-red-700 mt-1">
                    <strong>{teacherName}</strong> {t('teacherCurriculumBadges.qualifiedFor')}{' '}
                    <strong>{teacherEligibility || t('teacherCurriculumBadges.noCurriculum')}</strong>{' '}
                    {t('teacherCurriculumBadges.butClassRequires')}{' '}
                    <strong>{requiredCurriculum}</strong>.
                </p>
                <p className="text-xs text-red-600 mt-2">
                    {t('teacherCurriculumBadges.assignmentMayNotMeetStandards')}
                </p>
            </div>
        </div>
    );
}
