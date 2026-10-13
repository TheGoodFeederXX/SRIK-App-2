import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * AUDIT F27 — a feature this school does not have.
 *
 * WHAT THIS REPLACED. A child's homework list, with due dates, submissions and
 * marks, read through an Express server that is not deployed. This school keeps no
 * record of homework or submissions — there is no table for a piece of work set for
 * children to hand in.
 *
 * WHY NOT AN EMPTY LIST. A child opening this saw a blank page, which reads as
 * "you have no homework" — a statement a child would act on. "This is not built
 * yet" is true and a child can understand it.
 */
const AssignmentsScreen: React.FC<any> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('assignmentsScreen.myAssignments')}
        explanation={
            'Homework and assignments are not recorded in this system yet. '
            + 'When they are, you will see the work your teachers have set, when it is due, '
            + 'and whether it has been marked.'
        }
        handleBack={handleBack}
    />
    );
};

export default AssignmentsScreen;
