import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface ManagePermissionSlipsScreenProps {
    handleBack?: () => void;
    onBack?: () => void;
}

/**
 * Manage permission slips — replaced, because there are none to manage.
 *
 * WHAT WAS HERE. A register of permission slips: which child has one, which are awaiting a
 * reply, which classes have outstanding slips, and a student list to attach them to. Every
 * call went to an Express server that is not deployed, and there is NO permission-slip
 * table. The register was always empty and every action went nowhere.
 *
 * AN EMPTY REGISTER IS A PARTICULARLY BAD LIE. The office reads this screen to answer one
 * question: which children still owe a reply before a trip? A register that always answers
 * "nobody" is not a blank screen — it is a wrong answer to a safety question, given with
 * the same confidence as a right one.
 *
 * WHY IT IS NOT REBUILT HERE. Consent records carry legal weight, and capturing them
 * electronically is the school's decision rather than mine: whether an electronic reply is
 * acceptable, whose reply counts when two guardians disagree, whether withdrawn consent can
 * be recorded, and how long the record is kept. The paper slips in the class file remain the
 * safer record for now, because they are certainly real.
 */
const ManagePermissionSlipsScreen: React.FC<ManagePermissionSlipsScreenProps> = ({ handleBack, onBack }) => (
    <ComingSoonScreen
        title="Urus Slip Kebenaran"
        explanation={
            'Sekolah belum menggunakan slip kebenaran dalam talian, jadi tiada senarai untuk ' +
            'diuruskan di sini. Buat masa ini slip diedarkan dan dikumpul secara bertulis ' +
            'melalui guru kelas, dan senarai murid yang belum memulangkan slip disimpan di ' +
            'pejabat. Sekolah perlu menetapkan dahulu cara kebenaran ibu bapa direkodkan ' +
            'dalam sistem sebelum senarai ini boleh dipindahkan ke sini.'
        }
        handleBack={handleBack || onBack}
    />
);

export default ManagePermissionSlipsScreen;
