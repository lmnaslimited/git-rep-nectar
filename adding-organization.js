frappe.ui.form.on('Git Organization', {
    validate: async function(frm) {
        const provider = frm.doc.git_provider;
        const org = frm.doc.organization;

        if (!provider || !org) {
            frappe.throw(__('Both Git Provider and Organization are required.'));
            return;
        }

        try {
            // Step 1: Get Git Provider URL
            const provider_resp = await frappe.call({
                method: 'frappe.client.get_value',
                args: {
                    doctype: 'Git Provider',
                    filters: { name: provider },
                    fieldname: 'url'
                }
            });

            const base_url = provider_resp.message?.url?.replace(/\/+$/, '');
            if (!base_url) {
                frappe.throw(__('No API URL found for Git Provider "{0}".', [provider]));
                return;
            }

            // Step 2: Determine the organization check URL
            let check_url = '';
            if (base_url.includes('github.com')) {
                check_url = `${base_url}/orgs/${org}`;
            } else if (base_url.includes('gitlab.com')) {
                check_url = `${base_url}/groups/${encodeURIComponent(org)}`;
            } else {
                frappe.throw(__('Unsupported Git Provider API URL: {0}', [base_url]));
                return;
            }

            // Step 3: Call the public API
            const resp = await fetch(check_url, { method: 'GET' });

            if (!resp.ok) {
                frappe.throw(__('Organization "{0}" not found or is not publicly accessible on {1}.', [org, provider]));
                return;
            }

            // Optional success alert
            frappe.show_alert({
                message: __('Organization "{0}" verified on {1}.', [org, provider]),
                indicator: 'green'
            });

        } catch (err) {
            console.error(err);
            frappe.throw(__('Error while validating the organization. Please try again.'));
        }
    }
});
