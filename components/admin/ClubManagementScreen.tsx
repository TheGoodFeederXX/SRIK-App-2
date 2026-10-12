import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Club management — replaced, because no club is recorded here. The screen created clubs, ran their attendance register and tracked participation, all against an undeployed server, and there is no club table. It is not rebuilt here because the school follows its own co-curricular programme: which clubs run, who advises each one, how attendance is taken, and how it feeds a child's record. Free or subsidised activities, and who is entitled to them, are the school's decisions and not mine to encode.
 */
interface ClubManagementScreenProps {
    handleBack?: () => void;
}

const ClubManagementScreen: React.FC<ClubManagementScreenProps> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Pengurusan Kelab"
        explanation={
            'Pendaftaran dan kehadiran kelab belum tersedia di dalam sistem ini. Buat ' +
            'masa ini pendaftaran kelab dan rekod kehadiran aktiviti kokurikulum ' +
            'diuruskan secara bertulis oleh guru penasihat. Sila hubungi pejabat ' +
            'untuk urusan berkaitan kelab dan aktiviti kokurikulum.'
        }
        handleBack={handleBack}
    />
);

export default ClubManagementScreen;
