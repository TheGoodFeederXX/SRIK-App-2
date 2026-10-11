import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * AUDIT F27 — a feature this school does not have.
 *
 * WHAT THIS REPLACED. A class's homework list, with due dates and submission counts,
 * read through an Express server that is not deployed. This school keeps no record of
 * homework: `teaching_assignments` says who teaches which class and subject, which is
 * a different thing entirely, and there is no table for a piece of work set for
 * children to hand in.
 *
 * WHY NOT AN EMPTY LIST. The list came back empty every time, which reads as "this
 * class has no homework set" — a claim about the teacher's own planning. Saying the
 * feature is not built is both true and impossible to mistake for information.
 */
const ClassAssignmentsScreen: React.FC<any> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Class Assignments"
        explanation={
            'Homework and assignments are not recorded in this system yet. '
            + 'When they are, you will be able to set work for a class, give it a due date, '
            + 'and see who has handed it in.'
        }
        handleBack={handleBack}
    />
);

export default ClassAssignmentsScreen;
