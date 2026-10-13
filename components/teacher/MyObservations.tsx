import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * AUDIT F27 — this screen has no data behind it.
 *
 * It called an Express server that is not deployed, for records this school does
 * not keep: there is no table for it in the database. The screen showed a raw
 * request failure, which tells a teacher the app is broken when the truth is that
 * the feature was never built for this school.
 *
 * It now says so, and stores nothing. Nothing here is faked or pre-filled: an
 * empty-looking list would be worse than this, because a teacher would read it as
 * "no records yet" rather than "no such feature".
 *
 * When this feature is built, this file is replaced by the real screen.
 */
const MyObservations: React.FC<any> = ({ navigateTo }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('myObservations.myObservations')}
        explanation="Classroom observations are not recorded in this system yet. The office keeps these separately, so there is nothing here to show you."
        handleBack={() => navigateTo('dashboard', t('myObservations.dashboard'))}
    />
    );
};

export default MyObservations;
