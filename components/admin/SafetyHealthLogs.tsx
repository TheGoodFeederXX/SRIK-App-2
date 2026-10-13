import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface SafetyHealthLogsProps {
    handleBack?: () => void;
    onBack?: () => void;
}

/**
 * Safety and health logs — replaced, because none of the three records exist.
 *
 * WHAT WAS HERE. One screen showing three registers: health incidents, emergency drills
 * and a student list with "untagged" children. Every call went to an Express server that is
 * not deployed, and there is NO table for any of the three — no incident register, no drill
 * register, no tagging.
 *
 * WHY IT WAS WORSE THAN EMPTY. A safety register that always reads "no incidents recorded"
 * is not a neutral screen. It looks like a clean safety record — and a school inspector, or
 * the school's own management, could reasonably read it that way. An incident register that
 * cannot record an incident must not present itself as one.
 *
 * WHY IT IS NOT REBUILT HERE. An incident or drill register is evidence. It needs the
 * school's own procedure behind it: who records an incident, who must be told, whether the
 * record can be edited afterwards, and how long it is kept. Those are the school's rules to
 * set, not mine to invent — and a register that quietly gets one of them wrong is worse
 * than a register that admits it does not exist yet.
 */
const SafetyHealthLogs: React.FC<SafetyHealthLogsProps> = ({ handleBack, onBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('safetyHealthLogs.logKeselamatanKesihatan')}
        explanation={
            'Sekolah belum menyimpan daftar kes insiden, latihan kecemasan atau penandaan ' +
            'murid di dalam sistem ini. Buat masa ini rekod-rekod itu disimpan secara ' +
            'bertulis di pejabat. Sekolah perlu menetapkan dahulu siapa yang boleh ' +
            'merekodkan insiden, siapa yang perlu dimaklumkan dan berapa lama rekod ' +
            'disimpan, kerana daftar sebegini menjadi bukti rasmi sekolah. Sila hubungi ' +
            'pejabat untuk urusan berkaitan keselamatan murid.'
        }
        handleBack={handleBack || onBack}
    />
    );
};

export default SafetyHealthLogs;
