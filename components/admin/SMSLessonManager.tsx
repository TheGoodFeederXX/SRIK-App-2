import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { MessageSquare, Send, Info } from 'lucide-react';

const SMSLessonManager: React.FC = () => {
    const { t } = useTranslation();
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="p-6 max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-rose-100 rounded-xl">
                    <MessageSquare className="w-7 h-7 text-rose-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{t('sMSLessonManager.smsLessonManager')}</h1>
                    <p className="text-sm text-gray-500 mt-0.5">{t('sMSLessonManager.sendLessonSummariesAndSchoolUpdatesViaSMS')}</p>
                </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 text-center">
                <div className="flex justify-center mb-4">
                    <span className="bg-rose-100 text-rose-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">{t('sMSLessonManager.comingSoon')}</span>
                </div>
                <Send className="w-14 h-14 text-rose-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">{t('sMSLessonManager.smsProviderNotConfigured')}</h2>
                <p className="text-gray-600 max-w-md mx-auto mb-6">
                    This feature lets you send lesson summaries, fee reminders, and school updates directly to
                    parents and students via SMS — even on basic phones with no internet connection.
                </p>

                <div className="bg-white border border-rose-100 rounded-xl p-5 text-left max-w-md mx-auto">
                    <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-gray-800 mb-1">{t('sMSLessonManager.supportedSMSProvidersAnyOneRequired')}</p>
                            {/* Provider descriptions, with their operating region.
                                Two lines named gateways from a foreign country as
                                the school's options; this school is in Malaysia,
                                so the list describes reach, not a foreign market. */}
                            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                                <li><span className="font-medium">Twilio</span> {t('sMSLessonManager.globalReliableHigherCost')}</li>
                                <li><span className="font-medium">{t('sMSLessonManager.infobip')}</span> — {t('sMSLessonManager.globalEnterpriseMessaging')}</li>
                                <li><span className="font-medium">{t('sMSLessonManager.africaSTalking')}</span> — {t('sMSLessonManager.regionalProviderCheckMalaysiaCoverageBeforeUse')}</li>
                                <li><span className="font-medium">{t('sMSLessonManager.localMalaysianGateway')}</span> — arrange one directly with a local provider</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <p className="text-sm text-gray-500 mt-6">
                    Contact <span className="font-semibold text-rose-600">srialkhairiah@gmail.com</span> to activate SMS messaging for your school.
                </p>
            </div>
        </motion.div>
    );
};

export default SMSLessonManager;
