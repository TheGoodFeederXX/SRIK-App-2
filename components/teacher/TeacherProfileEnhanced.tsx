import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * AUDIT F27 — a profile built on records this school does not keep.
 *
 * WHAT THIS REPLACED. A teacher's profile with curriculum eligibility (KSSR /
 * British / Both), TRCN and British teaching qualifications, and uploaded
 * certificate documents — read and written through an Express server that is not
 * deployed. This school's `teachers` table holds a staff code, a name, contact
 * details, employment dates and a status. It has no eligibility field and no
 * qualification documents, so every part of this screen that mattered was reading
 * something that does not exist.
 *
 * WHY THE NAME AND PHONE ARE NOT SHOWN HERE EITHER. Showing the two fields that DO
 * exist, beside a form that cannot save the rest, is how someone comes to believe a
 * certificate was uploaded. The school's teacher record is editable by the office;
 * a teacher asking to change their own details goes through the office, which is
 * what actually happens today.
 */
const TeacherProfileEnhanced: React.FC<any> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('teacherProfileEnhanced.myProfile')}
        explanation={
            'Teaching qualifications and curriculum eligibility are not recorded in this '
            + 'system yet. The office keeps your contact details - ask them to change those. '
            + 'When this is built, you will be able to upload your certificates and set which '
            + 'curriculum you teach.'
        }
        handleBack={handleBack}
    />
    );
};

export default TeacherProfileEnhanced;
