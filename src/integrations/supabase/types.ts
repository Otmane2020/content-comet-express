export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_mentions: {
        Row: {
          answer: string | null
          brands: string[]
          checked_at: string
          created_at: string
          engine: string
          id: string
          mentioned: boolean
          project_id: string
          prompt: string
          rank: number | null
          user_id: string
        }
        Insert: {
          answer?: string | null
          brands?: string[]
          checked_at?: string
          created_at?: string
          engine: string
          id?: string
          mentioned?: boolean
          project_id: string
          prompt: string
          rank?: number | null
          user_id: string
        }
        Update: {
          answer?: string | null
          brands?: string[]
          checked_at?: string
          created_at?: string
          engine?: string
          id?: string
          mentioned?: boolean
          project_id?: string
          prompt?: string
          rank?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_mentions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_traffic: {
        Row: {
          assistant: string
          captured_at: string
          conversions: number
          created_at: string
          engaged_sessions: number
          id: string
          project_id: string
          sessions: number
          source: string
          user_id: string
          users: number
        }
        Insert: {
          assistant: string
          captured_at?: string
          conversions?: number
          created_at?: string
          engaged_sessions?: number
          id?: string
          project_id: string
          sessions?: number
          source: string
          user_id: string
          users?: number
        }
        Update: {
          assistant?: string
          captured_at?: string
          conversions?: number
          created_at?: string
          engaged_sessions?: number
          id?: string
          project_id?: string
          sessions?: number
          source?: string
          user_id?: string
          users?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_traffic_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          content_type: string | null
          cover_url: string | null
          created_at: string
          excerpt: string | null
          html: string | null
          id: string
          keywords: string[] | null
          markdown: string | null
          published_at: string
          slug: string
          title: string
        }
        Insert: {
          content_type?: string | null
          cover_url?: string | null
          created_at?: string
          excerpt?: string | null
          html?: string | null
          id?: string
          keywords?: string[] | null
          markdown?: string | null
          published_at?: string
          slug: string
          title: string
        }
        Update: {
          content_type?: string | null
          cover_url?: string | null
          created_at?: string
          excerpt?: string | null
          html?: string | null
          id?: string
          keywords?: string[] | null
          markdown?: string | null
          published_at?: string
          slug?: string
          title?: string
        }
        Relationships: []
      }
      competitors: {
        Row: {
          appearances: number | null
          best_position: number | null
          created_at: string
          domain: string
          id: string
          last_checked_at: string | null
          metrics: Json
          project_id: string
          snippet: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          appearances?: number | null
          best_position?: number | null
          created_at?: string
          domain: string
          id?: string
          last_checked_at?: string | null
          metrics?: Json
          project_id: string
          snippet?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          appearances?: number | null
          best_position?: number | null
          created_at?: string
          domain?: string
          id?: string
          last_checked_at?: string | null
          metrics?: Json
          project_id?: string
          snippet?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          body_md: string | null
          content_type: string
          cover_image_url: string | null
          created_at: string
          excerpt: string | null
          id: string
          model: string | null
          project_id: string
          published_url: string | null
          scheduled_date: string
          slug: string | null
          status: string
          target_keyword: string | null
          title: string | null
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body_md?: string | null
          content_type: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          model?: string | null
          project_id: string
          published_url?: string | null
          scheduled_date: string
          slug?: string | null
          status?: string
          target_keyword?: string | null
          title?: string | null
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body_md?: string | null
          content_type?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          model?: string | null
          project_id?: string
          published_url?: string | null
          scheduled_date?: string
          slug?: string | null
          status?: string
          target_keyword?: string | null
          title?: string | null
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connections: {
        Row: {
          account_email: string | null
          auto_publish: boolean
          created_at: string
          id: string
          last_error: string | null
          metadata: Json
          project_id: string
          resource_id: string | null
          resource_name: string | null
          service: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_email?: string | null
          auto_publish?: boolean
          created_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json
          project_id: string
          resource_id?: string | null
          resource_name?: string | null
          service: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_email?: string | null
          auto_publish?: boolean
          created_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json
          project_id?: string
          resource_id?: string | null
          resource_name?: string | null
          service?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      google_tokens: {
        Row: {
          access_token: string | null
          connection_id: string
          created_at: string
          expires_at: string | null
          refresh_token: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          connection_id: string
          created_at?: string
          expires_at?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          connection_id?: string
          created_at?: string
          expires_at?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_tokens_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "google_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          auto_publish: boolean
          config: Json
          created_at: string
          id: string
          label: string
          last_error: string | null
          platform: string
          project_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_publish?: boolean
          config?: Json
          created_at?: string
          id?: string
          label: string
          last_error?: string | null
          platform: string
          project_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_publish?: boolean
          config?: Json
          created_at?: string
          id?: string
          label?: string
          last_error?: string | null
          platform?: string
          project_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_research: {
        Row: {
          competition: number | null
          competitor_domain: string | null
          cpc: number | null
          created_at: string
          difficulty: number | null
          id: string
          intent: string | null
          keyword: string
          origin: string | null
          project_id: string
          relevance_score: number | null
          search_volume: number | null
          source: string
          used: boolean
          user_id: string
        }
        Insert: {
          competition?: number | null
          competitor_domain?: string | null
          cpc?: number | null
          created_at?: string
          difficulty?: number | null
          id?: string
          intent?: string | null
          keyword: string
          origin?: string | null
          project_id: string
          relevance_score?: number | null
          search_volume?: number | null
          source?: string
          used?: boolean
          user_id: string
        }
        Update: {
          competition?: number | null
          competitor_domain?: string | null
          cpc?: number | null
          created_at?: string
          difficulty?: number | null
          id?: string
          intent?: string | null
          keyword?: string
          origin?: string | null
          project_id?: string
          relevance_score?: number | null
          search_volume?: number | null
          source?: string
          used?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "keyword_research_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          audience: string | null
          business_profile: Json | null
          created_at: string
          id: string
          industry: string | null
          keywords: string[]
          locale: string | null
          name: string
          publish_hour: number
          target_country: string | null
          timezone: string
          tone: string | null
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          audience?: string | null
          business_profile?: Json | null
          created_at?: string
          id?: string
          industry?: string | null
          keywords?: string[]
          locale?: string | null
          name: string
          publish_hour?: number
          target_country?: string | null
          timezone?: string
          tone?: string | null
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          audience?: string | null
          business_profile?: Json | null
          created_at?: string
          id?: string
          industry?: string | null
          keywords?: string[]
          locale?: string | null
          name?: string
          publish_hour?: number
          target_country?: string | null
          timezone?: string
          tone?: string | null
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: []
      }
      publish_logs: {
        Row: {
          content_item_id: string
          created_at: string
          id: string
          integration_id: string | null
          message: string | null
          platform: string
          remote_url: string | null
          success: boolean
          user_id: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          id?: string
          integration_id?: string | null
          message?: string | null
          platform: string
          remote_url?: string | null
          success: boolean
          user_id: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          id?: string
          integration_id?: string | null
          message?: string | null
          platform?: string
          remote_url?: string | null
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_logs_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      search_metrics: {
        Row: {
          captured_at: string
          clicks: number
          ctr: number
          dimension: string
          id: string
          impressions: number
          label: string
          position: number | null
          project_id: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          clicks?: number
          ctr?: number
          dimension: string
          id?: string
          impressions?: number
          label: string
          position?: number | null
          project_id: string
          user_id: string
        }
        Update: {
          captured_at?: string
          clicks?: number
          ctr?: number
          dimension?: string
          id?: string
          impressions?: number
          label?: string
          position?: number | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_metrics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_notifications: {
        Row: {
          email: string | null
          notified_at: string
          user_id: string
        }
        Insert: {
          email?: string | null
          notified_at?: string
          user_id: string
        }
        Update: {
          email?: string | null
          notified_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          cycle: string | null
          email: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          cycle?: string | null
          email?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          cycle?: string | null
          email?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          business_description: string | null
          business_name: string | null
          competitors: Json
          completed: boolean
          completed_at: string | null
          country: string | null
          created_at: string
          current_step: number
          data_source: string
          detected: Json
          id: string
          industry: string | null
          keywords: Json
          language: string | null
          project_id: string | null
          shopify_installed: boolean
          shopify_shop_domain: string | null
          shopify_shop_name: string | null
          target_market: string | null
          tone: string | null
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          business_description?: string | null
          business_name?: string | null
          competitors?: Json
          completed?: boolean
          completed_at?: string | null
          country?: string | null
          created_at?: string
          current_step?: number
          data_source?: string
          detected?: Json
          id?: string
          industry?: string | null
          keywords?: Json
          language?: string | null
          project_id?: string | null
          shopify_installed?: boolean
          shopify_shop_domain?: string | null
          shopify_shop_name?: string | null
          target_market?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          business_description?: string | null
          business_name?: string | null
          competitors?: Json
          completed?: boolean
          completed_at?: string | null
          country?: string | null
          created_at?: string
          current_step?: number
          data_source?: string
          detected?: Json
          id?: string
          industry?: string | null
          keywords?: Json
          language?: string | null
          project_id?: string | null
          shopify_installed?: boolean
          shopify_shop_domain?: string | null
          shopify_shop_name?: string | null
          target_market?: string | null
          tone?: string | null
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_onboarding_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
