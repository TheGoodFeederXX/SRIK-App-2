
import { uploadFile } from '../../src/lib/supabase/storage';
import { requireSupabase } from '../../src/lib/supabase/client';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GeneratedResources, TermResources, GeneratedLessonPlan, GeneratedAssessment, AssessmentQuestion, DetailedNote } from '../../types';
import { DocumentTextIcon, ShareIcon, BookOpenIcon, ClipboardListIcon, ChevronRightIcon, SparklesIcon, CheckCircleIcon, RotateCcwIcon, ClockIcon } from '../../constants';

const Toast: React.FC<{ message: string; onClear: () => void; }> = ({ message, onClear }) => {
    useEffect(() => {
        const timer = setTimeout(onClear, 3000);
        return () => clearTimeout(timer);
    }, [onClear]);

    return (
        <div className="fixed bottom-24 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2 animate-slide-in-up z-50">
            <CheckCircleIcon className="w-5 h-5 text-green-400" />
            <span>{message}</span>
        </div>
    );
};

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
    <h3 className="font-bold text-lg text-purple-800 border-b-2 border-purple-200 pb-1 mb-3">{title}</h3>
);

const SchemeOfWorkTab: React.FC<{ scheme: TermResources['schemeOfWork'] }> = ({ scheme }) => {
    const { t } = useTranslation();
    return (
    <div className="overflow-x-auto bg-white p-2 rounded-lg border">
        <table className="min-w-full">
            <thead className="bg-gray-100">
                <tr>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-600 uppercase w-24">{t('common.week')}</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-600 uppercase">{t('common.topic')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
                {scheme.map(item => (
                    <tr key={item.week}>
                        <td className="px-4 py-3 font-bold text-gray-800">{item.week}</td>
                        <td className="px-4 py-3 text-gray-700">{item.topic}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
    );
};


const LessonPlanLink: React.FC<{ plan: GeneratedLessonPlan, onSuggest: () => void, onClick: () => void }> = ({ plan, onSuggest, onClick }) => {
    const { t } = useTranslation();
    return (
        <div className="flex items-center space-x-2">
            <button onClick={onClick} className="flex-grow text-left p-3 font-semibold flex justify-between items-center hover:bg-purple-50 bg-white rounded-lg border group transition-colors">
                <span className="text-purple-800 group-hover:text-purple-900">{t('common.week')} {plan.week}: {plan.topic}</span>
                <ChevronRightIcon className="h-5 w-5 text-gray-400" />
            </button>
            <button 
                onClick={(e) => { e.stopPropagation(); onSuggest(); }}
                className="p-3 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors"
                title={t('lessonPlanDetailScreen.suggestAIActivity')}
            >
                <SparklesIcon className="w-5 h-5" />
            </button>
        </div>
    );
};

const LessonPlansTab: React.FC<{ plans: TermResources['lessonPlans'], notes?: DetailedNote[], context: any, navigateTo: (view: string, title: string, props: any) => void; onSuggestActivity: (topic: string) => void; }> = ({ plans, notes, context, navigateTo, onSuggestActivity }) => {
    const { t } = useTranslation();
    const handlePlanClick = (plan: GeneratedLessonPlan) => {
        const noteData = notes?.find(n => n.topic === plan.topic);
        navigateTo('lessonContent', `Week ${plan.week}`, {
            lessonPlan: plan,
            detailedNote: noteData,
            context: context
        });
    };

    // Check if plans exist and have content
    if (!plans || plans.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 bg-white rounded-lg border-2 border-dashed border-gray-300">
                <BookOpenIcon className="h-16 w-16 text-gray-300 mb-4" />
                <p className="text-gray-500 font-medium mb-1">{t('lessonPlanDetailScreen.noLessonPlansAvailable')}</p>
                <p className="text-gray-400 text-sm">{t('lessonPlanDetailScreen.generateAIResourcesToCreateLessonPlans')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {plans.map(plan => (
                <LessonPlanLink 
                    key={plan.week} 
                    plan={plan} 
                    onClick={() => handlePlanClick(plan)} 
                    onSuggest={() => onSuggestActivity(plan.topic)}
                />
            ))}
        </div>
    );
};

const AssessmentDisplay: React.FC<{ assessment: GeneratedAssessment, subject: string, className: string, navigateTo: (view: string, title: string, props?: any) => void; }> = ({ assessment, subject, className, navigateTo }) => {
    const { t } = useTranslation();
    return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h4 className="font-bold text-xl mb-2 text-gray-800">{assessment.type} ({assessment.totalMarks} Marks)</h4>
        {assessment.questions.slice(0, 2).map(q => ( // Show a preview of first 2 questions
            <div key={q.id} className="mb-2 pb-2 border-b last:border-b-0 text-gray-900">
                <p className="font-semibold text-gray-800 truncate">{q.id}. {q.question}</p>
            </div>
        ))}
        <div className="mt-4 border-t pt-3">
            <button
                onClick={() => navigateTo('assignmentView', `${t('lessonPlanDetailScreen.assignment')}: ${assessment.type}`, { assessment, subject, className })}
                className="w-full text-center py-2 px-4 bg-purple-100 text-purple-700 font-semibold rounded-lg hover:bg-purple-200 transition-colors"
            >
                {t('lessonPlanDetailScreen.viewAsAssignment')}
            </button>
        </div>
    </div>
    );
};

const AssessmentsTab: React.FC<{ assessments: TermResources['assessments'], subject: string, className: string, navigateTo: (view: string, title: string, props?: any) => void; }> = ({ assessments, subject, className, navigateTo }) => {
    const { t } = useTranslation();
    // Check if assessments exist and have content
    if (!assessments || assessments.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 bg-white rounded-lg border-2 border-dashed border-gray-300">
                <ClipboardListIcon className="h-16 w-16 text-gray-300 mb-4" />
                <p className="text-gray-500 font-medium mb-1">{t('lessonPlanDetailScreen.noAssessmentsAvailable')}</p>
                <p className="text-gray-400 text-sm">{t('lessonPlanDetailScreen.generateAIResourcesToCreateAssessments')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {assessments
                .sort((a, b) => a.week - b.week)
                .map((ass, index) => <AssessmentDisplay key={index} assessment={ass} subject={subject} className={className} navigateTo={navigateTo} />)}
        </div>
    );
};


const TermContent: React.FC<{
    termResource: TermResources,
    resources: GeneratedResources,
    navigateTo: (view: string, title: string, props?: any) => void;
}> = ({ termResource, resources, navigateTo }) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'scheme' | 'plans' | 'assessments'>('scheme');

    // Extract context IDs from resources (passed from LessonPlannerScreen)
    const context = {
        subjectId: (resources as any).subjectId,
        classId: (resources as any).classId,
        teacherId: (resources as any).teacherId
    };

    return (
        <div>
            <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg mb-4 print:hidden">
                <button onClick={() => setActiveTab('scheme')} className={`w-1/3 py-2 text-sm font-semibold rounded-md transition-colors ${activeTab === 'scheme' ? 'bg-white shadow text-black' : 'text-gray-600 hover:bg-gray-300/50'}`}>{t('common.scheme')}</button>
                <button onClick={() => setActiveTab('plans')} className={`w-1/3 py-2 text-sm font-semibold rounded-md transition-colors ${activeTab === 'plans' ? 'bg-white shadow text-black' : 'text-gray-600 hover:bg-gray-300/50'}`}>{t('lessonPlanDetailScreen.lessonPlans')}</button>
                <button onClick={() => setActiveTab('assessments')} className={`w-1/3 py-2 text-sm font-semibold rounded-md transition-colors ${activeTab === 'assessments' ? 'bg-white shadow text-black' : 'text-gray-600 hover:bg-gray-300/50'}`}>{t('lessonPlanDetailScreen.assessments')}</button>
            </div>
            {activeTab === 'scheme' && <SchemeOfWorkTab scheme={termResource.schemeOfWork} />}
            {activeTab === 'plans' && <LessonPlansTab plans={termResource.lessonPlans} notes={resources.detailedNotes} context={context} navigateTo={navigateTo} onSuggestActivity={navigateTo.bind(null, 'suggestActivity')} />}
            {activeTab === 'assessments' && <AssessmentsTab assessments={termResource.assessments} subject={resources.subject} className={resources.className} navigateTo={navigateTo} />}
        </div>
    );
};

const LessonPlanDetailScreen: React.FC<{ resources: GeneratedResources; navigateTo: (view: string, title: string, props?: any) => void; }> = ({ resources, navigateTo }) => {
    const { t } = useTranslation();
    const [currentResources, setCurrentResources] = useState<GeneratedResources | null>(resources || null);
    const [activeTerm, setActiveTerm] = useState<string>(resources?.terms[0]?.term || '');
    const [toastMessage, setToastMessage] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);

    if (!resources || !currentResources) return <div className="flex items-center justify-center min-h-[40vh] p-8 text-center text-gray-500">{t('lessonPlanDetailScreen.openALessonPlanToViewItsDetails')}</div>;

    const activeTermData = currentResources.terms.find(t => t.term === activeTerm);

    const handlePublish = async () => {
        setIsPublishing(true);
        try {
            const content = JSON.stringify(currentResources, null, 2);
            const fileName = `lesson-plan-${Date.now()}.json`;
            const file = new File([content], fileName, { type: 'application/json' });

            // THE REAL STORAGE AND THE REAL TABLE. This used to call
            // `api.uploadFile('lesson-materials', ...)` and `api.createResource(...)` — an
            // undeployed server, a bucket that does not exist, and a `resources` table this
            // database has never had. So "publish" silently did nothing. Files now go to the
            // private `srik-documents` bucket and the row goes into `documents`, whose
            // columns are what this insert actually names.
            const uploaded = await uploadFile({ type: 'SCHOOL' }, file);

            const db = requireSupabase();
            const { data: { user } } = await db.auth.getUser();
            const { error } = await db.from('documents').insert({
                owner_type: 'SCHOOL',
                category: 'LESSON_PLAN',
                title: t('lessonPlanDetailScreen.lessonPlanTitle', {
                    subject: currentResources.subject,
                    className: currentResources.className,
                }),
                storage_key: uploaded.storageKey,
                mime_type: file.type,
                size_bytes: file.size,
                uploaded_by: user?.id ?? null,
            });
            if (error) throw new Error(error.message);

            setToastMessage(t('lessonPlanDetailScreen.planPublished'));
        } catch (err: any) {
            console.error('Publish error:', err);
            setToastMessage(t('lessonPlanDetailScreen.failedToPublish'));
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-100">
            {toastMessage && <Toast message={toastMessage} onClear={() => setToastMessage('')} />}
            <div className="p-3 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white print:hidden">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">{t('lessonPlanDetailScreen.lessonPlanHeading', { subject: resources.subject, className: resources.className })}</h2>
                </div>
                <div className="flex space-x-2">
                    <button
                        onClick={handlePublish}
                        disabled={isPublishing}
                        className="flex items-center space-x-1.5 px-3 py-1.5 text-sm font-semibold text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200 disabled:opacity-50"
                    >
                        <ShareIcon className="w-4 h-4" />
                        <span>{isPublishing ? t('lessonPlanDetailScreen.publishing') : t('lessonPlanDetailScreen.publishToLibrary')}</span>
                    </button>
                </div>
            </div>

            <main className="flex-grow overflow-y-auto p-4 printable-area">
                <div className="flex space-x-2 mb-4 print:hidden">
                    {currentResources.terms.map(term => (
                        <button key={term.term} onClick={() => setActiveTerm(term.term)} className={`px-4 py-2 font-semibold rounded-lg ${activeTerm === term.term ? 'bg-purple-600 text-white shadow' : 'bg-white text-gray-900'}`}>
                            {term.term}
                        </button>
                    ))}
                </div>
                {activeTermData ? <TermContent termResource={activeTermData} resources={currentResources} navigateTo={navigateTo} /> : <p className="text-gray-900">{t('lessonPlanDetailScreen.selectATermToViewResources')}</p>}
            </main>
        </div>
    );
};

export default LessonPlanDetailScreen;
