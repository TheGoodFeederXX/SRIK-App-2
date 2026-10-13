import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import SOPCaseDetailView from '../shared/SOPCaseDetailView';

interface SOPCaseDetailScreenProps {
    caseId: string;
}

const SOPCaseDetailScreen: React.FC<SOPCaseDetailScreenProps> = ({ caseId }) => {
    const { t } = useTranslation();
    if (!caseId) return <div className="text-center py-12 text-gray-500">{t('sOPCaseDetailScreen.noCaseSelected')}</div>;
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            <SOPCaseDetailView caseId={caseId} mode="admin" />
        </motion.div>
    );
};

export default SOPCaseDetailScreen;
