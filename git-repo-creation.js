frappe.ui.form.on('Git Repo', {
    party: handle_party_change,

    onload: function(frm) {
        handle_party_change(frm);
        if (!frm.is_new()) {
            frm.set_read_only();
            frm.disable_save();
        }
    },

    party_name: validate_git_org_permission,

    validate: handle_repo_creation
});

// --- Helper Functions ---

function handle_party_change(frm) {
    if (frm.doc.party === "Git User") {
        // Auto-fill and set party_name as read-only
        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Git User',
                filters: { user: frappe.session.user },
                fieldname: 'name'
            },
            callback: function({ message }) {
                if (message) {
                    frm.set_value('party_name', message.name);
                    frm.set_df_property('party_name', 'read_only', 1);
                } else {
                    frappe.msgprint(__('No Git User found for the current user.'));
                    frm.set_value('party_name', '');
                    frm.set_df_property('party_name', 'read_only', 0);
                }
                frm.refresh_field('party_name');
            }
        });
    } else if (frm.doc.party === "Git Organization") {
        // Clear and make party_name editable
        frm.set_value('party_name', '');
        frm.set_df_property('party_name', 'read_only', 0);
        frm.refresh_field('party_name');
    } else {
        // Reset party_name for other values
        frm.set_df_property('party_name', 'read_only', 0);
        frm.refresh_field('party_name');
    }
}


async function validate_git_org_permission(frm) {
    if (frm.doc.party !== "Git Organization" || !frm.doc.party_name || !frm.doc.provider) return;

    try {
        // Step 1: Get Git User
        const git_user_resp = await frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Git User',
                filters: { user: frappe.session.user },
                fieldname: ['name', 'valid_date', 'user']
            }
        });

        const git_user = git_user_resp.message;
        if (!git_user) {
            frappe.msgprint("No Git User record found for current user.");
            frm.set_value('party_name', '');
            return;
        }

        if (new Date(git_user.valid_date) < new Date()) {
            frappe.msgprint("Your PAT token is expired. Please renew it.");
            frm.set_value('party_name', '');
            return;
        }

        // Step 2: Get PAT
        const pat_resp = await frappe.call({
            method: "frappe.client.get_password",
            args: {
                doctype: "Git User",
                name: git_user.name,
                fieldname: "pat"
            }
        });

        const pat = pat_resp.message;
        if (!pat) {
            frappe.msgprint("No PAT found for the current Git User.");
            frm.set_value('party_name', '');
            return;
        }

        // Step 3: Get Git Provider URL
        const provider_resp = await frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Git Provider',
                filters: { name: frm.doc.provider },
                fieldname: 'url'
            }
        });

        const api_base = provider_resp.message?.url?.replace(/\/+$/, '');
        if (!api_base) {
            frappe.msgprint(`No API URL found for Git Provider "${frm.doc.provider}"`);
            frm.set_value('party_name', '');
            return;
        }

        // Step 4: Fetch user's organizations from GitHub/GitLab
        const orgs_resp = await fetch(`${api_base}/user/orgs`, {
            headers: {
                'Authorization': `token ${pat}`,
                'Accept': 'application/vnd.github+json'
            }
        });

        if (!orgs_resp.ok) {
            frappe.msgprint("Failed to fetch organizations from the Git Provider. Please check your PAT or provider.");
            frm.set_value('party_name', '');
            return;
        }

        const orgs = await orgs_resp.json();
        const org_names = orgs.map(org => org.login || org.name);  // Handle both GitHub and GitLab naming

        const is_valid_org = org_names.includes(frm.doc.party_name);

        if (!is_valid_org) {
            frappe.msgprint(__(`Invalid organization "${frm.doc.party_name}" for the selected Git Provider.`));
            frm.set_value('party_name', '');
        }

    } catch (error) {
        console.error(error);
        frappe.msgprint("An unexpected error occurred while validating the organization.");
        frm.set_value('party_name', '');
    }
}

async function handle_repo_creation(frm) {
    const { repo_name, provider, party, party_name, repo_visibility } = frm.doc;

    if (!repo_name || !provider || !party || !party_name) {
        frappe.throw("Please fill in Repo Name, Provider, Party, and Party Name.");
    }

    if (repo_name !== repo_name.toLowerCase()) {
        frappe.throw("Please use only lowercase letters for the Repo Name.");
    }

    // Get Git User and PAT
    const git_user_resp = await frappe.call({
        method: 'frappe.client.get_value',
        args: {
            doctype: 'Git User',
            filters: { user: frappe.session.user },
            fieldname: ['name', 'valid_date', 'user']
        }
    });

    const git_user = git_user_resp.message;
    if (!git_user) frappe.throw("No Git User mapping found for current user.");

    if (git_user.user !== frappe.session.user) {
        frappe.throw(`Please create the Git User for ${frappe.session.user}`);
    }

    if (new Date(git_user.valid_date) < new Date()) {
        frappe.throw("Your PAT token is expired. Please renew it.");
    }

    const pat_resp = await frappe.call({
        method: "frappe.client.get_password",
        args: {
            doctype: "Git User",
            name: git_user.name,
            fieldname: "pat"
        }
    });

    const pat = pat_resp.message;
    if (!pat) frappe.throw("No PAT found for the current Git User.");

    // Get Git Provider base URL
    const provider_resp = await frappe.call({
        method: 'frappe.client.get_value',
        args: {
            doctype: 'Git Provider',
            filters: { name: provider },
            fieldname: 'url'
        }
    });

    const provider_url = provider_resp.message?.url;
    if (!provider_url) frappe.throw(`No URL configured for Git Provider: ${provider}`);

    // Ensure no trailing slash
    const api_base = provider_url.replace(/\/+$/, '');
    const owner = party_name;

    const repo_url = `${api_base}/repos/${owner}/${repo_name}`;
    const create_endpoint = `${api_base}/${party === "Git Organization" ? `orgs/${owner}` : "user"}/repos`;

    // Check if repo already exists
    const existing_resp = await fetch(repo_url, {
        method: 'GET',
        headers: {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github+json'
        }
    });

    if (existing_resp.status === 401 || existing_resp.status === 403) {
        frappe.throw("Invalid or unauthorized PAT. Please provide a correct PAT for the current Git User.");
    }

    const existing_data = await existing_resp.json();
    if (existing_resp.ok && existing_data.html_url) {
        frm.set_value('repo_url', existing_data.html_url);
        frm.set_value('repo_visibility', existing_data.private ? 'private' : 'public');
        // frappe.msgprint(`Repository already exists: <a href="${existing_data.html_url}" target="_blank">${existing_data.html_url}</a>`);
        frappe.show_alert({message: 'Repository already exists on GitHub! Reverting...', indicator: 'green'});
        return;
        
    }

    // Create new repo
    const payload = {
        name: repo_name,
        private: repo_visibility === "private"
    };

    const create_resp = await fetch(create_endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (create_resp.status === 401 || create_resp.status === 403) {
        frappe.throw("Invalid or unauthorized PAT. Please provide a correct PAT for the current Git User.");
    }

    const create_data = await create_resp.json();
    if (create_resp.ok && create_data.html_url) {
        frm.set_value('repo_url', create_data.html_url);
        frappe.show_alert({message: 'Repository created successfully!', indicator: 'green'});
    } else {
        console.error(create_data);
        frappe.throw(`Failed to create repository: ${create_data.message || "Unknown error"}`);
    }
}









// frappe.ui.form.on('Git Repo', {
//     party: handle_party_change,

//     onload: function(frm) {
//         handle_party_change(frm);
//         if (!frm.is_new()) {
//             frm.set_read_only();
//             frm.disable_save();
//         }
//     },

//     party_name: validate_git_org_permission,

//     validate: handle_repo_creation
// });

// // --- Helper Functions ---

// function handle_party_change(frm) {
//     if (frm.doc.party === "Git User") {
//         // Auto-fill party_name with Git User record for current user
//         frappe.call({
//             method: 'frappe.client.get_value',
//             args: {
//                 doctype: 'Git User',
//                 filters: { user: frappe.session.user },
//                 fieldname: 'name'
//             },
//             callback: function({ message }) {
//                 if (message) {
//                     frm.set_value('party_name', message.name);
//                 } else {
//                     frappe.msgprint(__('No Git User found for the current user.'));
//                     frm.set_value('party_name', '');
//                 }
//             }
//         });
//     }
//     // party_name field remains always visible
// }

// function validate_git_org_permission(frm) {
//     if (frm.doc.party !== "Git Organization" || !frm.doc.party_name) return;

//     frappe.call({
//         method: 'frappe.client.get_value',
//         args: {
//             doctype: 'Git User',
//             filters: { user: frappe.session.user },
//             fieldname: 'name'
//         },
//         callback: function({ message }) {
//             if (!message) return;

//             const git_user_name = message.name;

//             frappe.call({
//                 method: 'frappe.client.get_list',
//                 args: {
//                     doctype: 'Git User Organizations',
//                     parent: "Git User",
//                     filters: { parent: git_user_name },
//                     fields: ['git_organization']
//                 },
//                 callback: function({ message }) {
//                     const allowed_orgs = message || [];
//                     const is_allowed = allowed_orgs.some(
//                         org => org.git_organization === frm.doc.party_name
//                     );

//                     if (!is_allowed) {
//                         frappe.msgprint(__('You are not allowed to create a repo in "{0}"', [frm.doc.party_name]));
//                         frm.set_value('party_name', '');
//                     }
//                 }
//             });
//         }
//     });
// }

// async function handle_repo_creation(frm) {
//     const { repo_name, provider, party, party_name, repo_visibility } = frm.doc;

//     if (!repo_name || !provider || !party || !party_name) {
//         frappe.throw("Please fill in Repo Name, Provider, Party, and Party Name.");
//     }

//     if (repo_name !== repo_name.toLowerCase()) {
//         frappe.throw("Please use only lowercase letters for the Repo Name.");
//     }

//     // Get Git User and PAT
//     const git_user_resp = await frappe.call({
//         method: 'frappe.client.get_value',
//         args: {
//             doctype: 'Git User',
//             filters: { user: frappe.session.user },
//             fieldname: ['name', 'valid_date']
//         }
//     });

//     const git_user = git_user_resp.message;
//     if (!git_user) frappe.throw("No Git User mapping found for current user.");

//     if (new Date(git_user.valid_date) < new Date()) {
//         frappe.throw("Your PAT token is expired. Please renew it.");
//     }

//     const pat_resp = await frappe.call({
//         method: "frappe.client.get_password",
//         args: {
//             doctype: "Git User",
//             name: git_user.name,
//             fieldname: "pat"
//         }
//     });

//     const pat = pat_resp.message;
//     if (!pat) frappe.throw("No PAT found for the current Git User.");

//     // Determine the GitHub owner
//     const owner = party_name;
//     const repo_url = `https://api.github.com/repos/${owner}/${repo_name}`;
//     const create_endpoint = `https://api.github.com/${party === "Git Organization" ? `orgs/${owner}` : "user"}/repos`;

//     // Check if repo already exists
//     const existing_resp = await fetch(repo_url, {
//         method: 'GET',
//         headers: {
//             'Authorization': `token ${pat}`,
//             'Accept': 'application/vnd.github+json'
//         }
//     });

//     // Handle unauthorized or forbidden due to incorrect PAT
//     if (existing_resp.status === 401 || existing_resp.status === 403) {
//         frappe.throw("Invalid or unauthorized PAT. Please provide a correct PAT for the current Git User.");
//     }

//     const existing_data = await existing_resp.json();
//     if (existing_resp.ok && existing_data.html_url) {
//         frm.set_value('repo_url', existing_data.html_url);
//         frm.set_value('repo_visibility', existing_data.private ? 'private' : 'public');
//         frappe.msgprint(`Repository already exists: <a href="${existing_data.html_url}" target="_blank">${existing_data.html_url}</a>`);
//         return;
//     }

//     // Create new repo
//     const payload = {
//         name: repo_name,
//         private: repo_visibility === "private"
//     };

//     const create_resp = await fetch(create_endpoint, {
//         method: 'POST',
//         headers: {
//             'Authorization': `token ${pat}`,
//             'Accept': 'application/vnd.github+json',
//             'Content-Type': 'application/json'
//         },
//         body: JSON.stringify(payload)
//     });

//     // Handle unauthorized or forbidden due to incorrect PAT
//     if (create_resp.status === 401 || create_resp.status === 403) {
//         frappe.throw("Invalid or unauthorized PAT. Please provide a correct PAT for the current Git User.");
//     }

//     const create_data = await create_resp.json();
//     if (create_resp.ok && create_data.html_url) {
//         frm.set_value('repo_url', create_data.html_url);
//         frappe.msgprint(`Repository created: <a href="${create_data.html_url}" target="_blank">${create_data.html_url}</a>`);
//     } else {
//         console.error(create_data);
//         frappe.throw(`Failed to create repository: ${create_data.message || "Unknown error"}`);
//     }
// }















// frappe.ui.form.on('Git Repo', {
//     party: handle_party_change,

//     onload: function(frm) {
//         handle_party_change(frm);
//         if (!frm.is_new()) {
//             frm.set_read_only();
//             frm.disable_save();
//         }
//     },

//     party_name: validate_git_org_permission,

//     validate: handle_repo_creation
// });

// // --- Helper Functions ---

// function handle_party_change(frm) {
//     if (frm.doc.party === "Git User") {
//         // Auto-fill party_name with Git User record for current user
//         frappe.call({
//             method: 'frappe.client.get_value',
//             args: {
//                 doctype: 'Git User',
//                 filters: { user: frappe.session.user },
//                 fieldname: 'name'
//             },
//             callback: function({ message }) {
//                 if (message) {
//                     frm.set_value('party_name', message.name);
//                 } else {
//                     frappe.msgprint(__('No Git User found for the current user.'));
//                     frm.set_value('party_name', '');
//                 }
//             }
//         });
//     }
//     // Do not hide party_name field anymore — always visible
// }

// function validate_git_org_permission(frm) {
//     if (frm.doc.party !== "Git Organization" || !frm.doc.party_name) return;

//     frappe.call({
//         method: 'frappe.client.get_value',
//         args: {
//             doctype: 'Git User',
//             filters: { user: frappe.session.user },
//             fieldname: 'name'
//         },
//         callback: function({ message }) {
//             if (!message) return;

//             const git_user_name = message.name;

//             frappe.call({
//                 method: 'frappe.client.get_list',
//                 args: {
//                     doctype: 'Git User Organizations',
//                     parent: "Git User",
//                     filters: { parent: git_user_name },
//                     fields: ['git_organization']
//                 },
//                 callback: function({ message }) {
//                     const allowed_orgs = message || [];
//                     const is_allowed = allowed_orgs.some(
//                         org => org.git_organization === frm.doc.party_name
//                     );

//                     if (!is_allowed) {
//                         frappe.msgprint(__('You are not allowed to create a repo in "{0}"', [frm.doc.party_name]));
//                         frm.set_value('party_name', '');
//                     }
//                 }
//             });
//         }
//     });
// }

// async function handle_repo_creation(frm) {
//     const { repo_name, provider, party, party_name, repo_visibility } = frm.doc;

//     // Basic validations
//     if (!repo_name || !provider || !party) {
//         frappe.throw("Please fill in Repo Name, Provider, and Party.");
//     }

//     if (repo_name !== repo_name.toLowerCase()) {
//         frappe.throw("Please use only lowercase letters for the Repo Name.");
//     }

//     // Get Git User and PAT
//     const git_user_resp = await frappe.call({
//         method: 'frappe.client.get_value',
//         args: {
//             doctype: 'Git User',
//             filters: { user: frappe.session.user },
//             fieldname: ['name', 'valid_date']
//         }
//     });

//     const git_user = git_user_resp.message;
//     if (!git_user) frappe.throw("No Git User mapping found for current user.");

//     if (new Date(git_user.valid_date) < new Date()) {
//         frappe.throw("Your PAT token is expired. Please renew it.");
//     }

//     const pat_resp = await frappe.call({
//         method: "frappe.client.get_password",
//         args: {
//             doctype: "Git User",
//             name: git_user.name,
//             fieldname: "pat"
//         }
//     });

//     const pat = pat_resp.message;
//     if (!pat) frappe.throw("No PAT found for the current Git User.");

//     // Prepare repo info
//     const owner = party === "Git Organization" ? party_name : git_user.name;
//     const repo_url = `https://api.github.com/repos/${owner}/${repo_name}`;
//     const create_endpoint = `https://api.github.com/${party === "Git Organization" ? `orgs/${owner}` : "user"}/repos`;

//     // Check if repo already exists
//     const existing_resp = await fetch(repo_url, {
//         method: 'GET',
//         headers: {
//             'Authorization': `token ${pat}`,
//             'Accept': 'application/vnd.github+json'
//         }
//     });

//     const existing_data = await existing_resp.json();
//     if (existing_resp.ok && existing_data.html_url) {
//         frm.set_value('repo_url', existing_data.html_url);
//         frm.set_value('repo_visibility', existing_data.private ? 'private' : 'public');
//         frappe.msgprint(`Repository already exists: <a href="${existing_data.html_url}" target="_blank">${existing_data.html_url}</a>`);
//         return;
//     }

//     // Create new repo
//     const payload = {
//         name: repo_name,
//         private: repo_visibility === "private"
//     };

//     const create_resp = await fetch(create_endpoint, {
//         method: 'POST',
//         headers: {
//             'Authorization': `token ${pat}`,
//             'Accept': 'application/vnd.github+json',
//             'Content-Type': 'application/json'
//         },
//         body: JSON.stringify(payload)
//     });

//     const create_data = await create_resp.json();
//     if (create_resp.ok && create_data.html_url) {
//         frm.set_value('repo_url', create_data.html_url);
//         frappe.msgprint(`Repository created: <a href="${create_data.html_url}" target="_blank">${create_data.html_url}</a>`);
//     } else {
//         console.error(create_data);
//         frappe.throw(`Failed to create repository: ${create_data.message || "Unknown error"}`);
//     }
// }




