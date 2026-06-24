using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

namespace bitOS
{
    public class Program : Form
    {
        private WebView2 webView;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Program());
        }

        public Program()
        {
            this.Text = "bitOS Sovereign Terminal";
            this.Width = 1024;
            this.Height = 768;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 15, 26); // Match app bg

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            this.Controls.Add(webView);

            this.Load += Program_Load;
        }

        private async void Program_Load(object sender, EventArgs e)
        {
            await webView.EnsureCoreWebView2Async(null);
            
            // Allow access to local files for PeerJS and DB
            string wwwPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www");
            
            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "bitos.local", 
                wwwPath, 
                CoreWebView2HostResourceAccessKind.Allow);

            webView.Source = new Uri("https://bitos.local/index.html");
            
            // Hide context menu and dev tools for a more native feel
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        }
    }
}