import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Hash, Smartphone, Info } from 'lucide-react';

const USSDWorkflow: React.FC = () => {
    const { t } = useTranslation();
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="p-6 max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-green-100 rounded-xl">
                    <Hash className="w-7 h-7 text-green-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{t('uSSDWorkflow.ussdWorkflowBuilder')}</h1>
                    <p className="text-sm text-gray-500 mt-0.5">{t('uSSDWorkflow.allowParentsStudentsToAccessSchoolInfoViaUSSDC')}</p>
                </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
                <div className="flex justify-center mb-4">
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">{t('uSSDWorkflow.comingSoon')}</span>
                </div>
                <Smartphone className="w-14 h-14 text-green-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">{t('uSSDWorkflow.ussdGatewayNotConnected')}</h2>
                <p className="text-gray-600 max-w-md mx-auto mb-6">
                    USSD lets parents and students dial a short code (e.g. <span className="font-mono font-semibold">*384#</span>) on any phone — even without internet —
                    to check fees, attendance, and results. This requires a USSD shortcode from a telecom operator.
                </p>

                <div className="bg-white border border-green-100 rounded-xl p-5 text-left max-w-md mx-auto">
                    <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-gray-800 mb-1">{t('uSSDWorkflow.whatSRequiredToActivateUSSD')}</p>
                            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                                <li>{t('uSSDWorkflow.aUSSDShortcodeFromMTNAirtelGloOr9mobile')}</li>
                                <li>{t('uSSDWorkflow.aUSSDGatewayProviderAfricaSTalkingRecommended')}</li>
                                <li>{t('uSSDWorkflow.apiCredentialsConfiguredInYourSchoolSettings')}</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <p className="text-sm text-gray-500 mt-6">
                    Contact <span className="font-semibold text-green-600">srialkhairiah@gmail.com</span> to set up USSD access for your school.
                </p>
            </div>
        </motion.div>
    );
};

export default USSDWorkflow;
