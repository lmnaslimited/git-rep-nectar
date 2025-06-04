frappe.ui.form.on('Git User', {
    user: function(frm) {
        validate_git_username(frm);
    }
});

function validate_git_username(frm) {
    const { git_provider, username, user } = frm.doc;

    if (!user) return;

    // Step 1: Check if another Git User exists with same user email
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Git User',
            filters: {
                user: user,
                name: ['!=', frm.doc.name]
            },
            limit: 1
        },
        callback: function(res) {
            if (res.message && res.message.length > 0) {
                frappe.msgprint(__('A Git User already exists with this User email.'));
                // Optionally clear the field or mark invalid
                frm.set_value('user', '');
                return;
            } else {
                frappe.msgprint({ message: __('User email is available.'), indicator: 'green' });
            }
        }
    });
}
