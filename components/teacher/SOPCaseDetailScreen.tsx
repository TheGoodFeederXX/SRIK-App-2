import React from 'react';
import { useTranslation } from 'react-i18next';
import SOPCaseDetailView from '../shared/SOPCaseDetailView';

interface SOPCaseDetailScreenProps {
    caseId: string;
}

const SOPCaseDetailScreen: React.FC<SOPCaseDetailScreenProps> = ({ caseId }) => {
    const { t } = useTranslation();
    if (!caseId) return <div className="text-center py-12 text-gray-500">{t('sOPCaseDetailScreen.noCaseSelected')}</div>;
    return <SOPCaseDetailView caseId={caseId} mode="teacher" />;
};

export default SOPCaseDetailScreen;
