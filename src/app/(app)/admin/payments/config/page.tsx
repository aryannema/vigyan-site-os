import { PageHeader } from '../../components/PageHeader';
import { getGatewayConfig } from './actions';
import { GatewayConfigForm } from './GatewayConfigForm';

export const dynamic = 'force-dynamic';

export default async function PaymentGatewayConfigPage() {
  const existing = await getGatewayConfig();

  return (
    <>
      <PageHeader
        title="Payment gateway"
        description={
          'Razorpay keys used at checkout. Stored in a dedicated, service-role-only table ' +
          '(payment_gateway_config) — never readable through the capability system or a ' +
          'browser session, only by this server-side code.'
        }
      />

      <div className="max-w-2xl">
        <GatewayConfigForm existing={existing} />
      </div>
    </>
  );
}
