import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Data Migration: Excel import, export and VIP pricing</h1>
        <p className={styles.text}>
          Bulk-edit your Shopify products in Excel and reward VIP customers with automatic pricing.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Excel export</strong>. Download products, variants, prices, inventory and SEO data in one click.
          </li>
          <li>
            <strong>Bulk import</strong>. Upload an edited file, preview every change, then update products safely.
          </li>
          <li>
            <strong>VIP pricing</strong>. Tagged VIP customers get their price automatically in cart and checkout.
          </li>
        </ul>
      </div>
    </div>
  );
}
