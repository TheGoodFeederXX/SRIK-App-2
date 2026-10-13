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
const MyClassHubScreen: React.FC<any> = ({ navigateTo }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('myClassHubScreen.myClassHub')}
        explanation="This summary is not built yet. Your class list, the register and the gradebook all work and are the places to go."
        handleBack={() => navigateTo('dashboard', 'Dashboard')}
    />
    );
};

export default MyClassHubScreen;
