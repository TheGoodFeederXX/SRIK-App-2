import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Classroom observation — replaced, because no observation is recorded here. The form scored a lesson against criteria for a chosen teacher, and every submission went to an undeployed server; there is no observation table. Care was taken with this one: an observation record is used in a teacher's supervision. Who observes whom, whether the teacher sees the result, whether it can be amended after a discussion, and how long it is kept are the school's professional decisions, and a form that gets them wrong damages a working relationship rather than merely losing data.
 */
interface ClassroomObservationScreenProps {
    handleBack?: () => void;
}

const ClassroomObservationScreen: React.FC<ClassroomObservationScreenProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('classroomObservationScreen.pemerhatianBilikDarjah')}
        explanation={
            'Sekolah belum menyimpan borang pemerhatian pengajaran di dalam sistem ' +
            'ini. Buat masa ini pemerhatian pengajaran dijalankan dan direkodkan ' +
            'secara bertulis. Sila hubungi pejabat atau guru besar untuk urusan ' +
            'berkaitan penyeliaan pengajaran.'
        }
        handleBack={handleBack}
    />
    );
};

export default ClassroomObservationScreen;
