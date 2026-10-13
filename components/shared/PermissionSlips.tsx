import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface PermissionSlipsProps {
    handleBack?: () => void;
    onBack?: () => void;
}

/**
 * Permission slips — replaced, because no slip exists to issue or sign.
 *
 * WHAT WAS HERE. A flow to create a permission slip, attach it to a student, and record
 * the parent's response — reading students and the signed-in user from a server that is not
 * deployed. There is NO permission-slip table. Nothing created was stored and nothing
 * signed was recorded.
 *
 * WHY THIS ONE MATTERS ESPECIALLY. A permission slip is CONSENT. If the screen accepted a
 * reply and stored nothing, the school would have no record that a parent agreed to a trip —
 * and a parent would believe they had given permission. The failure is not a lost
 * form: it is a trip taken without consent on file, which is a safeguarding problem rather
 * than a software one.
 *
 * WHY IT IS NOT REBUILT HERE. Consent records carry legal weight, and how they are captured
 * is the school's decision: whether an electronic reply is acceptable at all, whose reply
 * counts when two guardians disagree, whether a withdrawn consent can be recorded, and how
 * long the record is kept. The paper slip in a child's file is, for now, the safer record —
 * because it is certainly real.
 */
const PermissionSlips: React.FC<PermissionSlipsProps> = ({ handleBack, onBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('permissionSlips.slipKebenaran')}
        explanation={
            'Sekolah belum menggunakan slip kebenaran dalam talian. Buat masa ini slip ' +
            'kebenaran diedarkan dan dikumpul secara bertulis melalui guru kelas. Sekolah ' +
            'perlu menetapkan dahulu cara kebenaran ibu bapa direkodkan dan disimpan ' +
            'sebelum ia dipindahkan ke dalam sistem, kerana kebenaran bertulis adalah ' +
            'rekod rasmi yang penting untuk keselamatan murid. Sila hubungi pejabat untuk ' +
            'sebarang pertanyaan.'
        }
        handleBack={handleBack || onBack}
    />
    );
};

export default PermissionSlips;
