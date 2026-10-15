import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Quizzes — replaced, because there is no quiz to take. The screen listed quizzes and
 * assignments, showed past results and offered a CBT player. There is NO quizzes table, no
 * assignments table, no submissions table, and no quiz-question table — every call went to an
 * undeployed server.
 * 
 * It is not rebuilt here because a quiz shown to a child is teaching material, and it is also
 * an assessment. Who sets the questions, what happens to a score, whether a child can retake it
 * and whether the result counts toward anything are the school's decisions. A quiz that records
 * a score the school never sees is worse than no quiz, because the child believes they were
 * assessed.
 */
interface QuizzesScreenProps {
  navigateTo?: (view: string, title: string, props: any) => void;
  student?: { id?: string; name?: string } | null;
}

const QuizzesScreen: React.FC<QuizzesScreenProps> = ({ navigateTo, student }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        titleKey="quizzesScreen.kuiz"

        explanationKey="quizzesScreen.explanation"
        handleBack={navigateTo ? () => navigateTo('studentDashboard', t('quizzesScreen.papanPemuka'), { student }) : undefined}
    />
    );
};

export default QuizzesScreen;
