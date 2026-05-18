import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { PwaInstallBanner } from './components/PwaInstallBanner';

// Auth/Public — eager (rotas iniciais, sem chunk delay)
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
// Auxiliary components (Me, Notifications, PublicValidation) — V47: lazy-loaded
// pra evitar que V47 Alert Digest section infle o main bundle
const PublicValidation    = lazy(() => import('./pages/Auxiliary').then((m) => ({ default: m.PublicValidation })));
const Me                  = lazy(() => import('./pages/Auxiliary').then((m) => ({ default: m.Me })));
const Notifications       = lazy(() => import('./pages/Auxiliary').then((m) => ({ default: m.Notifications })));
import { MagicLinkApprove } from './pages/MagicLinkApprove';
import { NoAccess } from './pages/NoAccess';

// Hot path — eager (acessadas em > 80% das sessões)
import { Dashboard } from './pages/Dashboard';
import { Contracts } from './pages/Contracts';
import { ContractDetail } from './pages/ContractDetail';
import { ContractSheet } from './pages/ContractSheet';
import { Measurements } from './pages/Measurements';
import { MeasurementDetail } from './pages/MeasurementDetail';
import { Pendencias } from './pages/Pendencias';
import { MyApprovals } from './pages/MyApprovals';

// Cold path — lazy (acessadas raramente; carregam sob demanda)
const ContractForm        = lazy(() => import('./pages/ContractForm').then((m) => ({ default: m.ContractForm })));
const ContractLots        = lazy(() => import('./pages/ContractLots').then((m) => ({ default: m.ContractLots })));
const ContractParties     = lazy(() => import('./pages/ContractParties').then((m) => ({ default: m.ContractParties })));
const SovImportWizard     = lazy(() => import('./pages/SovImportWizard').then((m) => ({ default: m.SovImportWizard })));
const MeasurementMemoryPage = lazy(() => import('./pages/MeasurementMemoryPage').then((m) => ({ default: m.MeasurementMemoryPage })));
const MeasurementApprovePage = lazy(() => import('./pages/MeasurementApprovePage').then((m) => ({ default: m.MeasurementApprovePage })));
const MeasurementFieldEntry = lazy(() => import('./pages/MeasurementFieldEntry').then((m) => ({ default: m.MeasurementFieldEntry })));
const OfflineQueueInspector = lazy(() => import('./pages/OfflineQueueInspector').then((m) => ({ default: m.OfflineQueueInspector })));
const Financial           = lazy(() => import('./pages/Financial').then((m) => ({ default: m.Financial })));
const Schedule            = lazy(() => import('./pages/Schedule').then((m) => ({ default: m.Schedule })));
const Portfolio           = lazy(() => import('./pages/Portfolio').then((m) => ({ default: m.Portfolio })));
const Reports             = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const TenantTimeline      = lazy(() => import('./pages/TenantTimeline').then((m) => ({ default: m.TenantTimeline })));
const SanctionedSuppliers = lazy(() => import('./pages/SanctionedSuppliers').then((m) => ({ default: m.SanctionedSuppliers })));
const ApiKeysAdmin        = lazy(() => import('./pages/admin/ApiKeysAdmin').then((m) => ({ default: m.ApiKeysAdmin })));
const Eap                 = lazy(() => import('./pages/Eap').then((m) => ({ default: m.Eap })));
const SovVersionCompare   = lazy(() => import('./pages/SovVersionCompare').then((m) => ({ default: m.SovVersionCompare })));
const ContractPriceAudit  = lazy(() => import('./pages/ContractPriceAudit').then((m) => ({ default: m.ContractPriceAudit })));
const ContractPriceDivergence = lazy(() => import('./pages/ContractPriceDivergence').then((m) => ({ default: m.ContractPriceDivergence })));
const ContractCompetitorComparison = lazy(() => import('./pages/ContractCompetitorComparison').then((m) => ({ default: m.ContractCompetitorComparison })));
const ContractRiskAnalysis = lazy(() => import('./pages/ContractRiskAnalysis').then((m) => ({ default: m.ContractRiskAnalysis })));
const NotificationPreferences = lazy(() => import('./pages/NotificationPreferences').then((m) => ({ default: m.NotificationPreferences })));
const Additives           = lazy(() => import('./pages/Additives').then((m) => ({ default: m.Additives })));

// Contract submodules
const AdditiveDetail      = lazy(() => import('./pages/contracts').then((m) => ({ default: m.AdditiveDetail })));
const Tracking            = lazy(() => import('./pages/contracts').then((m) => ({ default: m.Tracking })));
const ContractReports     = lazy(() => import('./pages/contracts').then((m) => ({ default: m.Reports })));

// Unforeseen
const UnforeseenList      = lazy(() => import('./pages/UnforeseenItems').then((m) => ({ default: m.UnforeseenList })));
const UnforeseenDetail    = lazy(() => import('./pages/UnforeseenItems').then((m) => ({ default: m.UnforeseenDetail })));

// GED — lazy (módulo inteiro)
const Ged                 = lazy(() => import('./pages/ged').then((m) => ({ default: m.Ged })));
const GedCategories       = lazy(() => import('./pages/ged').then((m) => ({ default: m.GedCategories })));
const GedDocument         = lazy(() => import('./pages/ged').then((m) => ({ default: m.GedDocument })));
const GedDistribution     = lazy(() => import('./pages/ged').then((m) => ({ default: m.GedDistribution })));
const GedTerms            = lazy(() => import('./pages/ged').then((m) => ({ default: m.GedTerms })));
const GedDistributionWizard = lazy(() => import('./pages/ged').then((m) => ({ default: m.GedDistributionWizard })));
const GedDistributionDetail = lazy(() => import('./pages/ged').then((m) => ({ default: m.GedDistributionDetail })));
const GedUploadWizard     = lazy(() => import('./pages/ged/UploadWizard').then((m) => ({ default: m.GedUploadWizard })));
const GedRevisionUpload   = lazy(() => import('./pages/ged/UploadWizard').then((m) => ({ default: m.GedRevisionUpload })));
const GedDocumentDiff     = lazy(() => import('./pages/ged/Diff').then((m) => ({ default: m.GedDocumentDiff })));
const GedDashboard        = lazy(() => import('./pages/ged/Dashboard').then((m) => ({ default: m.GedDashboard })));
const GedDocumentApprove  = lazy(() => import('./pages/ged/Approve').then((m) => ({ default: m.GedDocumentApprove })));
const GedWatermarkLog     = lazy(() => import('./pages/ged/WatermarkLog').then((m) => ({ default: m.WatermarkLog })));
const GedWatermarkSettings = lazy(() => import('./pages/ged/WatermarkSettings').then((m) => ({ default: m.GedWatermarkSettings })));

// Admin — lazy (acessada por < 5% dos usuários)
const AdminPrograms       = lazy(() => import('./pages/admin/Programs').then((m) => ({ default: m.AdminPrograms })));
const AdminDisciplines    = lazy(() => import('./pages/admin/Disciplines').then((m) => ({ default: m.AdminDisciplines })));
const AdminAuditLog       = lazy(() => import('./pages/admin/AuditLog').then((m) => ({ default: m.AdminAuditLog })));
const AdminDigests        = lazy(() => import('./pages/admin/Digests').then((m) => ({ default: m.AdminDigests })));
const AdminBroadcast      = lazy(() => import('./pages/admin/Broadcast').then((m) => ({ default: m.AdminBroadcast })));
const AdminRoleAliases    = lazy(() => import('./pages/admin/RoleAliases').then((m) => ({ default: m.AdminRoleAliases })));
const AdminWebhooks       = lazy(() => import('./pages/admin/Webhooks').then((m) => ({ default: m.AdminWebhooks })));
const AdminWebhookQueue   = lazy(() => import('./pages/admin/WebhookQueue').then((m) => ({ default: m.AdminWebhookQueue })));
const AdminEconomicIndices = lazy(() => import('./pages/admin/EconomicIndices').then((m) => ({ default: m.AdminEconomicIndices })));
const AdminBulkReajuste    = lazy(() => import('./pages/admin/BulkReajuste').then((m) => ({ default: m.AdminBulkReajuste })));
const ContractReajustes    = lazy(() => import('./pages/contracts/ContractReajustes').then((m) => ({ default: m.ContractReajustes })));
const ContractRepactuacoes = lazy(() => import('./pages/contracts/ContractRepactuacoes').then((m) => ({ default: m.ContractRepactuacoes })));
const ContractReequilibrios = lazy(() => import('./pages/contracts/ContractReequilibrios').then((m) => ({ default: m.ContractReequilibrios })));
const ContractReceipts      = lazy(() => import('./pages/contracts/ContractReceipts').then((m) => ({ default: m.ContractReceipts })));
const ContractGuarantees    = lazy(() => import('./pages/contracts/ContractGuarantees').then((m) => ({ default: m.ContractGuarantees })));
const ContractParProcesses  = lazy(() => import('./pages/contracts/ContractParProcesses').then((m) => ({ default: m.ContractParProcesses })));
const ContractSanctions     = lazy(() => import('./pages/contracts/ContractSanctions').then((m) => ({ default: m.ContractSanctions })));
const ContractTimeline      = lazy(() => import('./pages/contracts/ContractTimeline').then((m) => ({ default: m.ContractTimeline })));
const ContractDashboard     = lazy(() => import('./pages/contracts/ContractDashboard').then((m) => ({ default: m.ContractDashboard })));
const AdminRiskBatch      = lazy(() => import('./pages/admin/RiskBatch').then((m) => ({ default: m.AdminRiskBatch })));
const WorkflowsAdmin      = lazy(() => import('./pages/admin/WorkflowsAdmin').then((m) => ({ default: m.WorkflowsAdmin })));
const AdminUsers          = lazy(() => import('./pages/admin').then((m) => ({ default: m.AdminUsers })));
const AdminTenants        = lazy(() => import('./pages/admin').then((m) => ({ default: m.AdminTenants })));
const Workflows           = lazy(() => import('./pages/admin').then((m) => ({ default: m.Workflows })));
const Backlog             = lazy(() => import('./pages/admin').then((m) => ({ default: m.Backlog })));

function P({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  return <ProtectedRoute roles={roles}>{children}</ProtectedRoute>;
}

/** Loading fallback minimalista exibido durante lazy chunk loading */
function ChunkLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-magenta dark:border-border-dark dark:border-t-purple-300" />
        <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          Carregando módulo
        </p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<ChunkLoading />}>
        <PwaInstallBanner />
        <Routes>
          {/* Public */}
          <Route path="/login"           element={<Login />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/v/:code"         element={<PublicValidation />} />
        <Route path="/aprovar/:token"  element={<MagicLinkApprove />} />
        <Route path="/no-access"       element={<NoAccess />} />

        {/* Root redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Core */}
        <Route path="/dashboard"          element={<P><Dashboard /></P>} />
        <Route path="/carteira"           element={<P><Portfolio /></P>} />
        <Route path="/pendencias"         element={<P><Pendencias /></P>} />
        <Route path="/timeline"           element={<P><TenantTimeline /></P>} />
        <Route path="/fornecedores-sancionados" element={<P><SanctionedSuppliers /></P>} />
        <Route path="/aprovacoes"         element={<P><MyApprovals /></P>} />
        <Route path="/relatorios"         element={<P><Reports /></P>} />
        <Route path="/me"                 element={<P><Me /></P>} />
        <Route path="/me/notificacoes"    element={<P><NotificationPreferences /></P>} />
        <Route path="/notifications"      element={<P><Notifications /></P>} />

        {/* Contracts */}
        <Route path="/contratos"                              element={<P><Contracts /></P>} />
        <Route path="/contratos/novo"                         element={<P roles={['admin', 'gestor_contrato']}><ContractForm /></P>} />
        <Route path="/contratos/:id"                          element={<P><ContractDetail /></P>} />
        <Route path="/contratos/:id/editar"                   element={<P roles={['admin', 'gestor_contrato']}><ContractForm /></P>} />
        <Route path="/contratos/:id/obras"                    element={<P><ContractLots /></P>} />
        <Route path="/contratos/:id/partes"                   element={<P><ContractParties /></P>} />
        <Route path="/contratos/:id/planilha"                 element={<P><ContractSheet /></P>} />
        <Route path="/contratos/:id/planilha/importar"        element={<P roles={['admin', 'gestor_contrato']}><SovImportWizard /></P>} />
        <Route path="/contratos/:id/medicoes"                 element={<P><Measurements /></P>} />
        <Route path="/contratos/:id/medicoes/:medId"          element={<P><MeasurementDetail /></P>} />
        <Route path="/contratos/:id/medicoes/:medId/memoria/:itemId" element={<P><MeasurementMemoryPage /></P>} />
        <Route path="/contratos/:id/medicoes/:medId/aprovar"  element={<P><MeasurementApprovePage /></P>} />
        <Route path="/contratos/:id/medicoes/:medId/campo"    element={<P><MeasurementFieldEntry /></P>} />
        <Route path="/medicoes/fila"                          element={<P><OfflineQueueInspector /></P>} />
        <Route path="/contratos/:id/aditivos"                 element={<P><Additives /></P>} />
        <Route path="/contratos/:id/aditivos/:adId"           element={<P><AdditiveDetail /></P>} />
        <Route path="/contratos/:id/itens-nao-previstos"      element={<P><UnforeseenList /></P>} />
        <Route path="/contratos/:id/itens-nao-previstos/:itemId" element={<P><UnforeseenDetail /></P>} />
        <Route path="/contratos/:id/rastreamento/:itemContratualId" element={<P><Tracking /></P>} />
        <Route path="/contratos/:id/financeiro"               element={<P><Financial /></P>} />
        <Route path="/contratos/:id/cronograma"               element={<P><Schedule /></P>} />
        <Route path="/contratos/:id/eap"                      element={<P><Eap /></P>} />
        <Route path="/contratos/:id/planilha/versoes"         element={<P><SovVersionCompare /></P>} />
        <Route path="/contratos/:id/auditoria-precos"         element={<P><ContractPriceAudit /></P>} />
        <Route path="/contratos/:id/divergencias-preco"       element={<P><ContractPriceDivergence /></P>} />
        <Route path="/contratos/:id/comparacao-concorrentes"  element={<P><ContractCompetitorComparison /></P>} />
        <Route path="/contratos/:id/risco"                    element={<P><ContractRiskAnalysis /></P>} />
        <Route path="/contratos/:id/relatorios"               element={<P><ContractReports /></P>} />

        {/* GED */}
        <Route path="/ged"                       element={<P><Ged /></P>} />
        <Route path="/ged/dashboard"             element={<P><GedDashboard /></P>} />
        <Route path="/ged/categorias"            element={<P><GedCategories /></P>} />
        <Route path="/ged/termos"                element={<P><GedTerms /></P>} />
        <Route path="/ged/documentos/novo"       element={<P><GedUploadWizard /></P>} />
        <Route path="/ged/documentos/:docId"     element={<P><GedDocument /></P>} />
        <Route path="/ged/documentos/:docId/nova-revisao" element={<P><GedRevisionUpload /></P>} />
        <Route path="/ged/documentos/:docId/diff"         element={<P><GedDocumentDiff /></P>} />
        <Route path="/ged/documentos/:docId/aprovar"      element={<P><GedDocumentApprove /></P>} />
        <Route path="/ged/documentos/:docId/marca-dagua-log" element={<P><GedWatermarkLog /></P>} />
        <Route path="/ged/configuracoes/marca-dagua"          element={<P><GedWatermarkSettings /></P>} />
        <Route path="/ged/distribuicao"          element={<P><GedDistribution /></P>} />
        <Route path="/ged/distribuicao/nova"      element={<P><GedDistributionWizard /></P>} />
        <Route path="/ged/distribuicao/:grdId"    element={<P><GedDistributionDetail /></P>} />

        {/* Admin */}
        <Route path="/admin/users"               element={<P roles={['admin']}><AdminUsers /></P>} />
        <Route path="/admin/tenants"             element={<P roles={['admin']}><AdminTenants /></P>} />
        <Route path="/admin/contratos/workflows" element={<P roles={['admin']}><WorkflowsAdmin /></P>} />
        <Route path="/admin/programs"            element={<P roles={['admin', 'gestor_contrato']}><AdminPrograms /></P>} />
        <Route path="/admin/disciplines"         element={<P roles={['admin', 'gestor_contrato']}><AdminDisciplines /></P>} />
        <Route path="/admin/auditoria"           element={<P roles={['admin']}><AdminAuditLog /></P>} />
        <Route path="/admin/digests"             element={<P roles={['admin']}><AdminDigests /></P>} />
        <Route path="/admin/broadcast"           element={<P roles={['admin']}><AdminBroadcast /></P>} />
        <Route path="/admin/alias-papeis"        element={<P roles={['admin']}><AdminRoleAliases /></P>} />
        <Route path="/admin/webhooks"            element={<P roles={['admin']}><AdminWebhooks /></P>} />
        <Route path="/admin/webhooks-fila"       element={<P roles={['admin']}><AdminWebhookQueue /></P>} />
        <Route path="/admin/api-keys"            element={<P roles={['admin']}><ApiKeysAdmin /></P>} />
        <Route path="/admin/indices-economicos"  element={<P roles={['admin']}><AdminEconomicIndices /></P>} />
        <Route path="/admin/reajustes-em-massa"  element={<P roles={['admin', 'gestor_contrato']}><AdminBulkReajuste /></P>} />
        <Route path="/contratos/:id/reajustes"   element={<P><ContractReajustes /></P>} />
        <Route path="/contratos/:id/repactuacoes" element={<P><ContractRepactuacoes /></P>} />
        <Route path="/contratos/:id/reequilibrios" element={<P><ContractReequilibrios /></P>} />
        <Route path="/contratos/:id/recebimentos"  element={<P><ContractReceipts /></P>} />
        <Route path="/contratos/:id/garantias"     element={<P><ContractGuarantees /></P>} />
        <Route path="/contratos/:id/processos-administrativos" element={<P><ContractParProcesses /></P>} />
        <Route path="/contratos/:id/sancoes"       element={<P><ContractSanctions /></P>} />
        <Route path="/contratos/:id/timeline"      element={<P><ContractTimeline /></P>} />
        <Route path="/contratos/:id/dashboard"     element={<P><ContractDashboard /></P>} />
        <Route path="/admin/risco-batch"         element={<P roles={['admin']}><AdminRiskBatch /></P>} />
        <Route path="/admin/backlog"             element={<P roles={['admin']}><Backlog /></P>} />

        {/* 404 fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}
