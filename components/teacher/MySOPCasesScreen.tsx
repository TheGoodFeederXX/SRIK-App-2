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
const MySOPCasesScreen: React.FC<any> = ({ navigateTo }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('mySOPCasesScreen.myReportedCases')}
        explanation="SOP case notes are not part of this school's records yet. Nothing you report here would be stored, so it has been switched off rather than leaving you with a box that silently loses what you type."
        handleBack={() => navigateTo('dashboard', 'Dashboard')}
    />
    );
};

export default MySOPCasesScreen;
