import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Results entry — replaced, because the exam it entered results for does not exist here. The
 * screen took continuous-assessment and exam marks per child, computed a total and a grade, and
 * saved them. It read exam and curriculum data from an undeployed server, and there is no
 * exam-result table.
 * 
 * It is not rebuilt here because entering marks already works properly: the Penilaian flow
 * records a score against a real assessment for a real class, and publishing it freezes the
 * result. A second marks screen that invented a curriculum choice (KSSR or British — this
 * school follows one) and then wrote to nothing would be a second, wrong way to do a job the
 * school can already do.
 */
interface ResultsEntryProps {
    teacherId?: string;
    classId?: string;
    examId?: string;
    // Was 'KSSR' | 'British' | 'Both'. The school teaches one curriculum, and nothing
    // ever read this prop, so the wider union only allowed a value that does not exist
    // here to be typed in.
    teacherCurriculumEligibility?: 'KSSR' | null;
    handleBack?: () => void;
}

export default function ResultsEntryEnhanced({ handleBack }: ResultsEntryProps) {
    const { t } = useTranslation();
    return (
        <ComingSoonScreen
            title={t('resultsEntryEnhanced.kemasukanMarkah')}
            explanation={
                'Kemasukan markah penilaian dibuat melalui menu Penilaian. Sila gunakan ' +
                'menu tersebut untuk merekod markah murid bagi penilaian yang telah ' +
                'disediakan. Sila hubungi pejabat jika terdapat masalah semasa merekod ' +
                'markah.'
            }
            handleBack={handleBack}
        />
    );
}
