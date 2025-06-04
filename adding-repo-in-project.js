frappe.ui.form.on('Project', {
   
    refresh(frm) {
        
        frm.set_df_property('custom_repo_url', 'hidden', true);
        frm.set_df_property('custom_git_username', 'hidden', true);
        frm.clear_custom_buttons();

        frappe.db.get_list('Task', {
            filters: { project: frm.doc.name },
            limit: 1
        }).then(tasks => {
            const is_linked_to_task = tasks.length > 0;
            if (is_linked_to_task) return;

            const has_repo = !!frm.doc.custom_git_repo_url;
            const is_new = frm.is_new();

            // Always show Delink if repo is linked
            if (has_repo) {
                frm.set_df_property('custom_git_username', 'hidden', false);
                frm.add_custom_button('Delink Repo', () => {
                    frappe.confirm('Are you sure you want to delink the repository?', () => {
                        frm.set_value('custom_git_repo_url', '');
                        frm.set_value('custom_git_username', '');
                        frm.save();
                    });
                });
            }

            // Show Link Repo if:
            // - form is new (draft) OR
            // - repo is not linked (even after delinking)
            if (is_new || !has_repo) {
                frm.add_custom_button('Link Repo', () => {
                    frappe.prompt([
                        {
                            label: 'Select Existing Repo',
                            fieldname: 'existing_repo',
                            fieldtype: 'Link',
                            options: 'Git Repo',
                            filters: { 'party': "Git Organization" }
                        }
                    ], (values) => {
                        frm.set_value('custom_git_repo_url', values.existing_repo);
                        frm.trigger('custom_git_repo_url');
                    });
                });
            }

            frm.refresh_field('custom_git_username');
           
        });
    },

    custom_git_repo_url(frm) {
        if (!frm.doc.custom_git_repo_url) {
            frm.set_df_property('custom_git_username', 'hidden', true);
            frm.refresh_field('custom_git_username');
            return;
        }

        frm.set_df_property('custom_git_username', 'hidden', false);

        frappe.db.get_value('Git Repo', frm.doc.custom_git_repo_url, 'owner')
            .then(res => {
                const email = res.message?.owner;
                if (!email) return;

                frappe.db.get_list('Git User', {
                    filters: { user: email },
                    fields: ['name']
                }).then(users => {
                    if (users.length === 1) {
                        frm.set_value('custom_git_username', users[0].name);
                    } else {
                        frappe.msgprint(__('No Git User found matching email "{0}"', [email]));
                    }
                });
            });

        frm.refresh_field('custom_git_username');
    },

     custom_git_username(frm) {
       fnValidateGitUser(frm)
    }
});

function fnValidateGitUser(frm){
     if (!frm.doc.custom_git_username || !frm.doc.custom_git_repo_url) {
            return;
        }

        const repoUrl = frm.doc.custom_git_repo_url;
        const match = repoUrl.match(/github\.com\/([^\/]+)\//);
        const repoOrg = match ? match[1] : null;

        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Git User',
                filters: { name: frm.doc.custom_git_username },
                fieldname: 'name'
            },
            callback: function (res) {
                if (!res.message) {
                    frappe.msgprint(__('Git User not found.'));
                   
                    return;
                }

                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'Git User Organizations',
                        parent: "Git User",
                        filters: { parent: frm.doc.custom_git_username },
                        fields: ['git_organization']
                    },
                    callback: function (response) {
                      
                        const orgList = response.message || [];
                        const orgNames = orgList.map(org => org.git_organization);

                        if (!orgNames.includes(repoOrg)) {
                            frm.set_value('custom_git_username', '');
                            frappe.throw(__('Git User is not associated with the organization in the repository URL.'));
                                
                            
                        }
                    }
                });
            }
        });
}

// frappe.ui.form.on('Project', {
    
//     refresh(frm) {
        
//         frm.set_df_property('custom_repo_url', 'hidden', true);
//         frm.set_df_property('custom_git_username', 'hidden', true);
//         frm.clear_custom_buttons();


//         frappe.db.get_list('Task', {
//             filters: { project: frm.doc.name },
//             limit: 1
//         }).then(tasks => {
//             const is_linked_to_task = tasks.length > 0;
//             if (is_linked_to_task) return;

//             // If repo is already linked, show Delink button
//             if (frm.doc.custom_git_repo_url) {
//                 frm.set_df_property('custom_git_username', 'hidden', false);
//                 frm.add_custom_button('Delink Repo', () => {
//                     frappe.confirm('Are you sure you want to delink the repository?', () => {
//                         frm.set_value('custom_git_repo_url', '');
//                         frm.set_value('custom_git_username', '');
//                         frm.save();
//                     });
//                 });
//             }

//             frm.add_custom_button('Link Repo', () => {
//                 frappe.prompt([
//                     {
//                         label: 'Select Existing Repo',
//                         fieldname: 'existing_repo',
//                         fieldtype: 'Link',
//                         options: 'Git Repo',
//                         filters: { 'party': "Git Organization" }
//                     }
//                 ], (values) => {
//                     frm.set_value('custom_git_repo_url', values.existing_repo);
//                     frm.trigger('custom_git_repo_url');
//                 });
//             });

//             frm.refresh_field('custom_git_username');
//         });
        
//     },

//     custom_git_repo_url(frm) {
//         if (!frm.doc.custom_git_repo_url) {
//             frm.set_df_property('custom_git_username', 'hidden', true);
//             frm.refresh_field('custom_git_username');
//             return;
//         }

//         frm.set_df_property('custom_git_username', 'hidden', false);

//         frappe.db.get_value('Git Repo', frm.doc.custom_git_repo_url, 'owner')
//             .then(res => {
//                 const email = res.message?.owner;
//                 if (!email) return;

//                 // Step 2: Find the Git User whose username matches the email
//                 frappe.db.get_list('Git User', {
//                     filters: { user: email },
//                     fields: ['name']
//                 }).then(users => {
//                     if (users.length === 1) {
//                         frm.set_value('custom_git_username', users[0].name);
//                     } else {
//                         frappe.msgprint(__('No Git User found matching email "{0}"', [email]));
//                     }
//                 });
//             });

//         frm.refresh_field('custom_git_username');
//     },
    
//     custom_git_username(frm) {
//         if (!frm.doc.custom_git_username || !frm.doc.custom_git_repo_url) {
//             return;
//         }
//         const repoUrl = frm.doc.custom_git_repo_url;
//         const match = repoUrl.match(/github\.com\/([^\/]+)\//);
//         const repoOrg = match ? match[1] : null;
    
//         console.log("url", repoUrl)
//         console.log("org", repoOrg)
        
       
//         frappe.call({
//             method: 'frappe.client.get_value',
//             args: {
//                 doctype: 'Git User',
//                 filters: { name: frm.doc.custom_git_username },
//                 fieldname: 'name'
//             },
//             callback: function(res) {
//                 console.log("Git list", res.message)
//                 if (!res.message) {
//                     frappe.msgprint(__('Git User not found.'));
//                     return;
//                 }
    
//                 const gitUserName = res.message.name;
    
                
//                 frappe.call({
//                  method: 'frappe.client.get_list',
//                 args: {
//                     doctype: 'Git User Organizations',
//                     parent: "Git User",
//                     filters: { parent: frm.doc.custom_git_username },
//                     fields: ['git_organization']
//                 },
//                 callback: function(response) {
                    
//                     // console.log("Git list", response.message)
//                     const orgList = response.message || [];
//                     const orgNames = orgList.map(org => org.git_organization);

//                     console.log("Allowed orgs for user:", orgNames);

//                 if (!orgNames.includes(repoOrg)) {
//                     frappe.msgprint(__('Git User is not associated with the organization in the repository URL.'));
                    
//                 }
//                 }
               
//                 });
//             }
//         });
//     }
    
// });














