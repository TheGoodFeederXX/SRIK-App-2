import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface HealthLogScreenProps {
    handleBack?: () => void;
    onBack?: () => void;
}

/**
 * Health log — replaced, because the school keeps no such record here.
 *
 * WHAT WAS HERE. A full clinic log: record a child's visit, the reason, the treatment, the
 * time, and browse past entries. Every call went to an Express server that is not deployed,
 * and there is NO health-log table in the database. Nothing recorded was ever stored, and
 * nothing read was ever read.
 *
 * WHY IT WAS WORSE THAN EMPTY. The dashboard's health widget showed `latestHealthLog =
 * null` hard-coded, rendering "No recent health logs". An office that had recorded twenty
 * visits would see that same reassuring sentence — it reads as "nothing has happened"
 * rather than "this is not connected". That widget is gone too.
 *
 * WHY IT IS NOT REBUILT HERE. A child's medical record is the most sensitive data in the
 * building. It needs a decision the school has not made: who may see it (the class teacher?
 * everyone?), how long it is kept, and whether it belongs in this system at all rather than
 * in the office's own file. A table built by guessing those answers would put a child's
 * medical history behind exactly the wrong door. The paper log and the office remain the
 * correct place until the school decides otherwise.
 */
const HealthLogScreen: React.FC<HealthLogScreenProps> = ({ handleBack, onBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('healthLogScreen.logKesihatan')}
        explanation={
            'Sekolah belum menyimpan rekod kesihatan murid di dalam sistem ini. Buat masa ini ' +
            'rekod rawatan di sekolah disimpan secara bertulis di pejabat. Rekod kesihatan ' +
            'kanak-kanak adalah maklumat yang paling sensitif, jadi sekolah perlu menetapkan ' +
            'dahulu siapa yang boleh melihatnya dan berapa lama ia disimpan sebelum ia ' +
            'dipindahkan ke dalam sistem. Sila hubungi pejabat untuk urusan kesihatan murid.'
        }
        handleBack={handleBack || onBack}
    />
    );
};

export default HealthLogScreen;
